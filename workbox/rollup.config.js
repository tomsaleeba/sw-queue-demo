import nodeResolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import injectProcess from './rollup-plugin-inject-process'
// import { terser } from 'rollup-plugin-terser'

export default {
  input: 'sw-src/sw.js',
  output: [
    {
      file: 'dist/sw-needsinjecting.js',
      format: 'iife',
    },
    // FIXME isn't doing its thing :(
    // {
    //   file: 'dist/sw-needsinjecting.min.js',
    //   format: 'iife',
    //   sourcemap: true,
    //   plugins: [terser()],
    // },
  ],
  plugins: [
    nodeResolve(), // lets us find dependencies in node_modules
    commonjs(),
    injectProcess(['NODE_ENV']),
  ],
}
