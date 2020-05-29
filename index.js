'use strict';

const EventEmitter = require('events');
const MongoDB = require('mongodb');
const SbError = require('@shieldsbetter/sberror');
const sift = require('sift');

const CollectionNoLongerValid = SbError.subtype('CollectionNoLongerValid', 
        'Underlying collection became invalidated.');
const MirrorClosed = SbError.subtype('MirrorClosed', 
        'This LocalMongoDbCollectionMirror has been closed.');
const NoSuchKey = SbError.subtype('NoSuchKey', 'No such key: {{key}}');

const THIRTY_SECONDS_AS_MS = 30 * 1000;

module.exports = class LocalMongoDbCollectionMirror extends EventEmitter {
    constructor(collection) {
        super();
        
        this.collection = collection;
        this.cache = new Map();
        
        this.collection.find({}).toArray()
        .then(docs => {
            for (let doc of docs) {
                setCachedValue(doc, doc, this);
            }
            
            this.changeStream =
                    buildChangeStream(this, {
                        startAtOperationTime:
                                new MongoDB.Timestamp(0, 
                                    Math.floor(Date.now() / 1000) - 30)
                    });
            
            doEmit(this, 'ready', this);
        });
    }
    
    changeHandler(change) {
        this.lastOpId = change._id;
        
        switch (change.operationType) {
            case 'delete':
            case 'insert':
            case 'replace':
            case 'update': {
                setCachedValue(change.documentKey, change.fullDocument, this);
                break;
            }
            case 'invalidate': {
                doEmit(this, 'invalidated', this, change);
                
                // Important this happens after the event is emitted, because
                // events won't be emitted once we're invalid.
                this.invalid = true;
                
                break;
            }
            default: {
                /* We ignore other sorts of updates. */
            }
        }
    }
    
    close() {
        return new Promise((resolve, reject) => {
            function closeStream(stream) {
                stream.close().then(resolve).catch(reject);
            }
        
            if (this.changeStream) {
                closeStream(this.changeStream);
            }
            else {
                this.on('ready', () => {
                    closeStream(this.changeStream);
                });
            }
        }).then(() => this.closed = true);
    }
    
    find(query) {
        assertState(this);
        
        let result = [];
    
        const predicate = sift(query);
        for (let value of this.cache.values()) {
            if (predicate(value)) {
                result.push(value);
            }
        }
        
        return result;
    }
    
    get(key) {
        const docKey = JSON.stringify(key);
        
        if (!this.cache.has(docKey)) {
            throw new NoSuchKey({ docKey });
        }
        
        return this.cache.get(docKey);
    }
    
    isReady() {
        return !!this.changeStream && !this.invalid && !this.closed;
    }
    
    isValid() {
        return !this.invalid;
    }
    
    isClosed() {
        return this.closed;
    }
    
    async waitUntilReady() {
        if (!this.changeStream) {
            await new Promise((resolve, reject) => {
                this.on('ready', resolve);
            });
        }
    }
};

function doEmit(mirror, eventName, ...args) {
    if (mirror.isValid()) {
        mirror.emit(eventName, ...args);
    }
}

function assertState(mirror) {
    if (mirror.invalid) {
        throw new CollectionNoLongerValid();
    }
    
    if (mirror.closed) {
        throw new MirrorClosed();
    }
}

/**
 * Some weirdness here.  Change events include a key, which is a subset of the
 * changed document including the key-parts (of which `_id` is all we care about
 * since anything else if a sharding key).  Change events also include (at our
 * request) the full document--but this is the document as it stands when the
 * event is sent to the client, and the client can request a backlog of events,
 * so the full documents as included in the events can differ very significantly
 * from what they looked like at the time of the change.  For the most part this
 * doesn't matter--we always just want the most recent version of the doc, and
 * that's what we're given.  However, in cases where a change event refers to a
 * document that is later deleted, the full document provided to us will be
 * `null`, while the key in the change will reflect that part of the document
 * that was its key at the time of the change.  So when changes call this, they
 * will likely pass something different for the `keyDoc` and the `doc`, while
 * in situations (like when we first populate the cache using a normal `find()`)
 * where we know we're looking at an existent doc, the caller will likely pass
 * the same doc as both the keyDoc and doc.  In those cases where we're
 * "setting" the key to the document `null`, we instead treat that as a delete.
 */
function setCachedValue(keyDoc, doc, mirror) {
    const docKey = cacheKey(keyDoc);
    
    if (doc !== null && doc !== undefined) {
        mirror.cache.set(docKey, doc);
    }
    else {
        mirror.cache.delete(docKey);
    }
    
    doEmit(mirror, 'changed', this, docKey);
}

function cacheKey(doc) {
    return JSON.stringify(doc._id);
}

function buildChangeStream(mirror, options) {
    options = Object.assign({ fullDocument: 'updateLookup' }, options);

    const changeStream = mirror.collection.watch([], options);
    changeStream.on('change', mirror.changeHandler.bind(mirror));
    
    return changeStream;
}
