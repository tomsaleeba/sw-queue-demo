import Vue from 'vue'
import App from './App.vue'

Vue.config.productionTip = false

new Vue({
  render: h => h(App),
}).$mount('#app')

if ('serviceWorker' in navigator) {
  // Register service worker
  navigator.serviceWorker
    .register('/sw-dist.js')
    // .register('/sw-dist.min.js') use this for the minified version
    .then(function(reg) {
      console.log('SW registration succeeded. Scope is ' + reg.scope)
    })
    .catch(function(err) {
      console.error('SW registration failed with error ' + err)
    })
}
