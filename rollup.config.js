import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';

export default {
  input: 'src/widget.ts',
  output: [
    {
      file: 'dist/js/v1/authnex.min.js',
      format: 'umd',
      name: 'AuthNex',
      sourcemap: true,
      plugins: [terser()],
    },
    {
      file: 'dist/js/v1/authnex.esm.js',
      format: 'es',
      sourcemap: true,
    },
  ],
  plugins: [
    resolve(),
    typescript({ tsconfig: './tsconfig.json' }),
  ],
};
