Coding up the demo from https://github.com/craig552uk/craig552uk.github.com/blob/96be6ef3221c3b8f4b3ee234a04db015b6917934/_posts/2016-01-29-service-worker-messaging.markdown.


To use it:
  1. start a web server in this dir (I'll assume port 8080)
  1. open your browser to http://localhost:8080/client1.html
  1. also open http://localhost:8080/client2.html
  1. open the dev tools in both pages. There's nothing to see in the page
     itself; it all happens in the consoles
  1. in the client1 page console, run `sendMessageToSw('hello').then(m =>
     console.log(m))`. You should see the log from the SW in *both* pages but
     the response only in the client1 page.
  1. run the same fragment in client2 and you'll see the response only in that page
  1. change the console to the service worker script context and run
     `sendMessageToAllClients('blah')`. You should see each client logging the
     message it receives and the service worker logs will appear in both pages'
     consoles
