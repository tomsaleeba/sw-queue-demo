# Quickstart
  1. `yarn` to install deps
  1. `yarn serve` to build and serve the app
  1. open your browser to http://localhost:8080

# TODO
  - can we shortcircuit a delete by sending a message to the SW to drop any
    pending requests for that obsId?
  - do we treat edits (PUTs) exactly the same as POSTs?
  - what do we do when an item on the queue expires? We still need it to
     be tried again. There doesn't seem to be a way to hook the deletes
     https://github.com/GoogleChrome/workbox/blob/55b7cbf743a4f542d0b1bfb7a102e063d50ca0cd/packages/workbox-background-sync/src/Queue.ts#L205.
     We could always break encapsulation and go into the IDB store and check
     for expiry ourselves. The code also mentions that we can do this approach:
     https://github.com/GoogleChrome/workbox/blob/55b7cbf743a4f542d0b1bfb7a102e063d50ca0cd/packages/workbox-background-sync/src/Queue.ts#L110
  - why do we see the log msg for a synthetic error once on the server but the
      error doesn't seem to actually happen. But if we see the log msg twice,
      then the error does happen.
  - show local-only records so the UI can act one them

# Assumption:
  - service worker is a newer API than IndexedDB so anywhere we have a SW, we'll
      have IDB also
  - it's safer to have the SW use its own DB, which means duplicated data but
      easier to maintain

# Lessons learned
  - We can generate failures by running our own HTTP server with express that
      uses Math.rand() to decide when to return an error.
  - Service Workers don't currently have support for `import`
    (https://stackoverflow.com/a/53439890/1410035). Potentially we could build a
    helper script that is built and then `importScripts` that helper but at that
    stage, you might as well just build the whole SW. You could also
    `importScripts` just the libraries you need directly from a CDN but then
    part of your app is out of your control. Probably safer to build it all and
    deploy it all together.
  - `throw`ing an error in the `onSync` on a queue will result in an `Uncaught
    (in promise)` message. That doesn't achieve anything so it's probably best
    not to throw.
  - it's easiest to build the service worker without minification (and
    therefore a sourcemap) because the `workbox` cli command processes the
    output from rollup to inject the manifest, and this means we loose any
    sourcemaps, etc. I'm not sure if we could process a minified file anyway.
