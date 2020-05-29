'use strict';

const assert = require('assert');
const deepEqual = require('deep-equal');
const Mirror = require('./index');
const MongoClient = require('mongodb').MongoClient;

const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replSet;
let client;
let db;
let dbCount = 0;

beforeAll(async () => {
    replSet = new MongoMemoryReplSet({
        replSet: { storageEngine: 'wiredTiger' }
    });
    await replSet.waitUntilRunning();
    
    client = await MongoClient.connect(
            await replSet.getUri(), { useUnifiedTopology: true });
});

afterAll(async () => {
    await replSet.stop();
});

beforeEach(() => {
    db = client.db(`testDb${dbCount}`);
    dbCount++;
});

afterEach(async () => {
    await db.dropDatabase();
    db = undefined;
});

test('populates with initial data', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    await db.collection('foocol').insertOne({
        _id: 'def',
        bazz: {
            waldo: 'plugh'
        }
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    await mirror.waitUntilReady();
    
    const docs = mirror.find({});
    
    assertDocSetsEqual(docs, [
        { _id: 'abc', foo: 'bar' },
        { _id: 'def', bazz: { waldo: 'plugh' } }
    ]);
    
    assert(mirror.has('abc'));
    assert.deepEqual(mirror.get('abc'), { _id: 'abc', foo: 'bar' });
    
    assert(!mirror.has('ghi'));
    try {
        mirror.get('ghi');
        assert.fail('should fail');
    }
    catch (e) {
        assert.equal(e.code, 'NO_SUCH_KEY', e);
    }
    
    await mirror.close();
});

test('tracks update, raises change event', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    await mirror.waitUntilReady();
    
    let changedEvent = false;
    mirror.on('changed', () => changedEvent = true);
    
    await db.collection('foocol').updateOne(
            { _id: 'abc' }, { $set: { foo: 'bar2' }});
    
    await snooze();
    
    assert(changedEvent);
    
    const docs = mirror.find({});
    
    assertDocSetsEqual(docs, [
        { _id: 'abc', foo: 'bar2' }
    ]);
    
    await mirror.close();
});

test('tracks delete', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    await mirror.waitUntilReady();
    
    await db.collection('foocol').deleteOne({ _id: 'abc' });
    
    await snooze();
    
    const docs = mirror.find({});
    
    assertDocSetsEqual(docs, []);
    
    assert(!mirror.has('abc'));
    try {
        mirror.get('abc');
        assert.fail('should fail');
    }
    catch (e) {
        assert.equal(e.code, 'NO_SUCH_KEY', e);
    }
    
    await mirror.close();
});

test('ignores drops, ' +
        'tracks invalidate, ' +
        'can\'t find() invalid, no further changes', async () => {
    
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    
    let invalidatedEvent = false;
    mirror.on('invalidated', () => invalidatedEvent = true);
    
    await mirror.waitUntilReady();
    
    // This is an important snooze: ready just means we've started the change
    // stream after our initial listing of the current collection state.  But
    // our change stream goes into the past a bit to account for potential
    // server drift, so we're almost certainly going to have the above insert
    // event still playing out.  Let's give that a chance to filter through.
    await snooze();
    
    assert(!invalidatedEvent);
    await db.dropCollection('foocol');
    
    let changedEvent = false;
    mirror.on('changed', () => changedEvent = true);
    
    await snooze();
    
    // Let's fake a late update coming in.
    mirror.changeHandler({
        operationType: 'update',
        documentKey: { _id: 'abc' },
        fullDocument: null
    });
    
    await snooze();
    
    assert(invalidatedEvent);
    assert(!mirror.isValid());
    assert(!changedEvent);
    
    try {
        await mirror.find({});
        assert.fail();
    }
    catch (e) {
        assert.equal(e.code, 'COLLECTION_NO_LONGER_VALID', e);
    }
    
    await mirror.close();
});

test('find filters', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        value: 'bar'
    });
    
    await db.collection('foocol').insertOne({
        _id: 'def',
        value: 'bazz'
    });
    
    await db.collection('foocol').insertOne({
        _id: 'ghi',
        value: 'plugh'
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    await mirror.waitUntilReady();
    
    const docs = mirror.find({ value: { $in: ['bar', 'plugh'] }});
    
    assertDocSetsEqual(docs, [
        { _id: 'abc', value: 'bar' },
        { _id: 'ghi', value: 'plugh' }
    ]);
    
    await mirror.close();
});

test('not ready until it\'s ready', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    const puppetCollection = wrapCollection(db.collection('foocol'));
    const mirror = new Mirror(puppetCollection);
    
    let readyEvent = false;
    let afterWaitUntilReady = false;
    mirror.on('ready', () => readyEvent = true);
    mirror.waitUntilReady().then(() => afterWaitUntilReady = true);
    
    const docs1 = mirror.find({});
    assertDocSetsEqual(docs1, []);
    
    await snooze();
    
    assert(!mirror.isReady());
    assert(!readyEvent);
    assert(!afterWaitUntilReady);
    
    puppetCollection.release();
    
    await snooze();
    
    assert(mirror.isReady());
    assert(readyEvent);
    assert(afterWaitUntilReady);
    
    const docs2 = mirror.find({});
    assertDocSetsEqual(docs2, [{
        _id: 'abc',
        foo: 'bar'
    }]);
    
    await mirror.close();
});

test('already ready falls through', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    await mirror.waitUntilReady();
    await mirror.waitUntilReady();
    
    await mirror.close();
});

test('close before actually open', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    const puppetCollection = wrapCollection(db.collection('foocol'));
    const mirror = new Mirror(puppetCollection);
    
    let readyEvent = false;
    let afterWaitUntilReady = false;
    mirror.on('ready', () => readyEvent = true);
    mirror.waitUntilReady().then(() => afterWaitUntilReady = true);
    
    await snooze();
    
    assert(!mirror.isReady());
    assert(!readyEvent);
    assert(!afterWaitUntilReady);
    
    mirror.close();
    
    await snooze();
    
    assert(!mirror.isClosed());
    
    puppetCollection.release();
    
    await snooze();
    
    assert(!mirror.isReady());
    assert(readyEvent);
    assert(afterWaitUntilReady);
    assert(mirror.isClosed());
});

test('search after close fails', async () => {
    await db.collection('foocol').insertOne({
        _id: 'abc',
        foo: 'bar'
    });
    
    await db.collection('foocol').insertOne({
        _id: 'def',
        bazz: {
            waldo: 'plugh'
        }
    });
    
    const mirror = new Mirror(db.collection('foocol'));
    await mirror.waitUntilReady();
    await mirror.close();
    
    try {
        mirror.find({});
        assert.fail('should fail');
    }
    catch (e) {
        assert.equal(e.code, 'MIRROR_CLOSED', e);
    }
});

async function snooze() {
    await new Promise((resolve, reject) => {
        setTimeout(resolve, 100);
    });
}

function assertDocSetsEqual(actual, expected) {
    if (actual.length != expected.length) {
        throw new assert.AssertionError({
            message: 'Expected sets to be equal, but lengths differed.',
            actual,
            expected
        });
    }
    else {
        const oneWay = actual.every(
                el1 => expected.findIndex(el2 => deepEqual(el1, el2)) !== -1);
        const theOther = expected.every(
                el2 => actual.findIndex(el1 => deepEqual(el1, el2)) !== -1);
        
        if (!oneWay || !theOther) {
            throw new assert.AssertionError({
                message: 'Expected sets to be equal, but an element differed.',
                actual,
                expected
            });
        }
    }
}

function wrapCollection(collection) {
    
    return {
        find(...args) {
            const wrapperThis = this;
            
            return {
                async toArray() {
                    await new Promise((resolve, reject) => {
                        wrapperThis.release = resolve;
                    });
                
                    return await collection.find(...args).toArray();
                }
            };
        },
        
        watch(pipeline, options) {
            const realChangeStream = collection.watch(pipeline, options);
            
            let cachedEvents = {
                change: [],
                close: [],
                end: [],
                error: [],
                resumeTokenChanged: []
            };
            
            for (let eventName of Object.keys(cachedEvents)) {
                realChangeStream.on(eventName, (...args) =>
                        cachedEvents[eventName].push([...args]));
            }
            
            const listeners = {};
            
            return {
                async close() {
                    await realChangeStream.close();
                },
            
                on(eventName, listener) {
                    if (!listeners[eventName]) {
                        listeners[eventName] = [];
                    }
                    
                    listeners[eventName].push(listener);
                },
                
                release() {
                    for (let eventName of Object.keys(cachedEvents)) {
                        for (let cachedEvent of cachedEvents[eventName]) {
                            for (let listener of (listeners[eventName] || [])) {
                                listener(...cachedEvent);
                            }
                        }
                    }
                    
                    cachedEvents = {
                        change: [],
                        close: [],
                        end: [],
                        error: [],
                        resumeTokenChanged: []
                    };
                }
            };
        }
    };
}
