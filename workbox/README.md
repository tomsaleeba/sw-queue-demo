TODO
  - how can we generate failures? Cutting the network will be hard when the
    requests are so small/quick. Perhaps settings throttling to give more time
    or generate the error in our code if we have a hook available.
  - 

Assumption:
  - service worker is a newer API than IndexedDB so anywhere we have a SW, we'll
      have IDB also
