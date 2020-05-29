# Overview

This library simply replicates a MongoDb collection from an existing deployment
into memory, keeping it up to date via a change stream, and providing basic
querying and change-alerting functionality.

Note that the target MongoDb deployment must be a replica set (though a cluster
of size 1 is fine.)  Change streams aren't provided for non-replica-set MongoDb
deployments.  Couldn't tell you why.

```javascript
const CollectionMirror = require('@shieldsbetter/local-mongodb-collection-mirror');
const { MongoClient } = require('mongodb');

async main() {
    const client = MongoClient.connect(process.env.MONGO_CONNECT_STRING);
    const fooMirror = new CollectionMirror(
            client.db('fooDb').collection('fooCollection'));
    
    await fooMirror.waitUntilReady();
    
    fooMirror.on('changed',
            (mirror, key) => console.log(`Document "${key}" changed.`));
    
    // No need for `await`!  This is a synchronous scan of docs in memory.
    for (let doc of fooMirror.find({ bar: { $in: ['plugh', 'waldo'] } }) {
        console.log(doc);
    }
}

main().catch(e => console.log(e));
```

# Motivation

Frequently, in light production situations a cloud configuration service would
be beneficial, but a full deployment of `consul`, `etcd` or their ilk would be
overkill.

Since a database service is likely already available, it can serve as a
clearinghouse for shared configuration data.

# API

## Methods

### &lt;constructor&gt;(collection)

Takes a collection from the MongoDb node drive (as derived perhaps from
`mongoClient.db('fooDb').collection('fooCollection')`) and immediately kicks off
the process of populating an in-memory mirror of the documents in that
collection.

### async close()

Blocks until the underlying `ChangeStream` is closed and associated resources
are released.  Future calls to query methods will throw `MirrorClosed` errors.

### find(query)

Takes a MongoDb-like query (specifically, something acceptable to
[sift](https://www.npmjs.com/package/sift)) and returns an array containing the
subset of documents that match.  If no documents match, an empty array will be
returned.

Returned documents will be copies and modifying them will not modify underlying
data.

### get(key)

Takes a MongoDb document id and returns the corresponding document.  If a
document with that key does not exist, throws a `NoSuchKey` error.

### has(key)

Takes a MongoDb document id and returns `true` **iff** a document with that key
is present in the mirror.

### isClosed()

Returns `true` **iff** the mirror has been gracefully closed.

### isReady()

Returns `true` **iff** the following three criteria are met:

1) The mirror has not yet been closed
2) The underlying collection has not become invalidated
3) The mirror has completed the initial process of seeding itself with documents
   currently present in the collection and begun watching the collection for
   future changes

### isValid()

Returns `true` **iff** the underlying collection has not become invalidated.
Collections can become invalidated by being dropped, renamed, or being part of
a database that is dropped.

### async waitUntilReady()

Blocks until `isReady()` would return true.  (Or, if `isReady()` would already
return true, returns immediately.)

## Events

### invalidated

Fired when the underlying collection becomes invalidated, which happens when it
is dropped, renamed, or is part of a database that is dropped.  Following this
event, calls to query methods will throw `CollectionNoLongerValid` errors.

Callback will receive the mirror instance as its first argument and the
MongoDb change stream event as its second argument, which may contain details
about why the collection has become invalidated.

### ready

Fired when the mirror transitions from its initial process of seeding itself
with documents currently present in the collection into the steady state of
watching the change stream for additional changes.

Callback will receive the mirror instance as its first and only argument.

### changed

Fired when a document is locally inserted, removed, or modified.

Callback will receive the mirror instance as its first argument and the MongoDb
document id of the changed document as its second argument.
