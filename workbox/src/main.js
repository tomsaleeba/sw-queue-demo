import Vue from 'vue'
import App from './App.vue'

Vue.config.productionTip = false

new Vue({
  render: h => h(App),
}).$mount('#app')

if ('serviceWorker' in navigator) {
  // Register service worker
  navigator.serviceWorker
    .register('/service-worker.mjs')
    .then(function(reg) {
      console.log('SW registration succeeded. Scope is ' + reg.scope)
    })
    .catch(function(err) {
      console.error('SW registration failed with error ' + err)
    })

  navigator.serviceWorker.addEventListener('message', function(event) {
    console.log('Client received message: ' + event.data)
    event.ports[0].postMessage('Client says "hello back!"')
  })
}
