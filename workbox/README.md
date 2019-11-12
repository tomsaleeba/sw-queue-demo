# Quickstart
  1. `yarn` to install deps
  1. `yarn serve` to build and serve the app
  1. open your browser to http://localhost:8080

# TODO
  - how can we generate failures? Cutting the network will be hard when the
    requests are so small/quick. Perhaps setting throttling to give more time
    or generate the error in our code if we have a hook available. We could
    also add a sleep to our server-side code to slow things down
  - inject manifest to built SW
  - can we shortcircuit a delete by sending a message to the SW to drop any
    pending requests for that obsId?
  - do we treat edits (PUTs) exactly the same as POSTs?
  - what do we do when an item on the queue expires? We still need it to
     be tried again. There doesn't seem to be a way to hook the deletes
     https://github.com/GoogleChrome/workbox/blob/55b7cbf743a4f542d0b1bfb7a102e063d50ca0cd/packages/workbox-background-sync/src/Queue.ts#L205.
     We could always break encapsulation and go into the IDB store and check
     for expiry ourselves. The code also mentions that we can do this approach:
     https://github.com/GoogleChrome/workbox/blob/55b7cbf743a4f542d0b1bfb7a102e063d50ca0cd/packages/workbox-background-sync/src/Queue.ts#L110
  - can we backout of building the service worker with webpack and just use ESM
      import statement to get what we need? The trick is making those modules
      available. I think we'd need to define our own module as an entry point
      that imports what we need, make sure it's built as ESM and import it from
      the SW. **Answer**: no, there's not support for `import` https://stackoverflow.com/a/53439890/1410035.
      Maybe if we can build the helper as a module that imports itself to a
      variable, then `importScripts` that into the sw
  - do we still get a NOOP service worker for free? If not, how do we make one?
  - why do we see the log msg for a synthetic error once on the server but the
      error doesn't seem to actually happen. But if we see the log msg twice,
      then the error does happen.
  - what happens if we queue up a few obs as fast as the UI will let us? Do
      things get jumbled, do we just process one obs fully, then the next? What
      if something goes wrong, where do we stop?

# Assumption:
  - service worker is a newer API than IndexedDB so anywhere we have a SW, we'll
      have IDB also
  - it's safer to have the SW use its own DB, which means duplicated data but
      easier to maintain
