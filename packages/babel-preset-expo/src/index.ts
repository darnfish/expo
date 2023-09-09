/* eslint-env node */

import { ConfigAPI, PluginItem, TransformOptions } from '@babel/core';

import { lazyImports } from './lazyImports';

type BabelPresetExpoPlatformOptions = {
  useTransformReactJSXExperimental?: boolean;
  disableImportExportTransform?: boolean;
  // Defaults to undefined, set to something truthy to disable `@babel/plugin-transform-react-jsx-self` and `@babel/plugin-transform-react-jsx-source`.
  withDevTools?: boolean;
  // Defaults to undefined, set to `true` to disable `@babel/plugin-transform-flow-strip-types`
  disableFlowStripTypesTransform?: boolean;
  // Defaults to undefined, set to `false` to disable `@babel/plugin-transform-runtime`
  enableBabelRuntime?: boolean;
  // Defaults to `'default'`, can also use `'hermes-canary'`
  unstable_transformProfile?: 'default' | 'hermes-canary';
};

export type BabelPresetExpoOptions = {
  lazyImports?: boolean;
  reanimated?: boolean;
  jsxRuntime?: 'classic' | 'automatic';
  jsxImportSource?: string;
  web?: BabelPresetExpoPlatformOptions;
  native?: BabelPresetExpoPlatformOptions;
};

function babelPresetExpo(api: ConfigAPI, options: BabelPresetExpoOptions = {}): TransformOptions {
  const { web = {}, native = {}, reanimated } = options;

  const bundler = api.caller(getBundler);
  const isWebpack = bundler === 'webpack';
  let platform = api.caller((caller) => (caller as any)?.platform);

  // If the `platform` prop is not defined then this must be a custom config that isn't
  // defining a platform in the babel-loader. Currently this may happen with Next.js + Expo web.
  if (!platform && isWebpack) {
    platform = 'web';
  }

  const platformOptions: BabelPresetExpoPlatformOptions =
    platform === 'web'
      ? {
          // Only disable import/export transform when Webpack is used because
          // Metro does not support tree-shaking.
          disableImportExportTransform: isWebpack,
          ...web,
        }
      : { disableImportExportTransform: false, ...native };

  // Note that if `options.lazyImports` is not set (i.e., `null` or `undefined`),
  // `metro-react-native-babel-preset` will handle it.
  const lazyImportsOption = options?.lazyImports;

  const extraPlugins: PluginItem[] = [
    // `metro-react-native-babel-preset` configures this plugin with `{ loose: true }`, which breaks all
    // getters and setters in spread objects. We need to add this plugin ourself without that option.
    // @see https://github.com/expo/expo/pull/11960#issuecomment-887796455
    [require.resolve('@babel/plugin-proposal-object-rest-spread'), { loose: false }],
  ];

  // Set true to disable `@babel/plugin-transform-react-jsx`
  // we override this logic outside of the metro preset so we can add support for
  // React 17 automatic JSX transformations.
  // If the logic for `useTransformReactJSXExperimental` ever changes in `metro-react-native-babel-preset`
  // then this block should be updated to reflect those changes.
  if (!platformOptions.useTransformReactJSXExperimental) {
    extraPlugins.push([
      require('@babel/plugin-transform-react-jsx'),
      {
        // Defaults to `automatic`, pass in `classic` to disable auto JSX transformations.
        runtime: (options && options.jsxRuntime) || 'automatic',
        ...(options &&
          options.jsxRuntime !== 'classic' && {
            importSource: (options && options.jsxImportSource) || 'react',
          }),
      },
    ]);
    // Purposefully not adding the deprecated packages:
    // `@babel/plugin-transform-react-jsx-self` and `@babel/plugin-transform-react-jsx-source`
    // back to the preset.
  }

  const aliasPlugin = getAliasPlugin();
  if (aliasPlugin) {
    extraPlugins.push(aliasPlugin);
  }

  if (platform === 'web') {
    extraPlugins.push(require.resolve('babel-plugin-react-native-web'));
  }

  return {
    presets: [
      [
        // We use `require` here instead of directly using the package name because we want to
        // specifically use the `metro-react-native-babel-preset` installed by this package (ex:
        // `babel-preset-expo/node_modules/`). This way the preset will not change unintentionally.
        // Reference: https://github.com/expo/expo/pull/4685#discussion_r307143920
        require('metro-react-native-babel-preset'),
        {
          // Defaults to undefined, set to something truthy to disable `@babel/plugin-transform-react-jsx-self` and `@babel/plugin-transform-react-jsx-source`.
          withDevTools: platformOptions.withDevTools,
          // Defaults to undefined, set to `true` to disable `@babel/plugin-transform-flow-strip-types`
          disableFlowStripTypesTransform: platformOptions.disableFlowStripTypesTransform,
          // Defaults to undefined, set to `false` to disable `@babel/plugin-transform-runtime`
          enableBabelRuntime: platformOptions.enableBabelRuntime,
          // Defaults to `'default'`, can also use `'hermes-canary'`
          unstable_transformProfile: platformOptions.unstable_transformProfile,
          // Set true to disable `@babel/plugin-transform-react-jsx` and
          // the deprecated packages `@babel/plugin-transform-react-jsx-self`, and `@babel/plugin-transform-react-jsx-source`.
          //
          // Otherwise, you'll sometime get errors like the following (starting in Expo SDK 43, React Native 64, React 17):
          //
          // TransformError App.js: /path/to/App.js: Duplicate __self prop found. You are most likely using the deprecated transform-react-jsx-self Babel plugin.
          // Both __source and __self are automatically set when using the automatic jsxRuntime. Please remove transform-react-jsx-source and transform-react-jsx-self from your Babel config.
          useTransformReactJSXExperimental: true,

          disableImportExportTransform: platformOptions.disableImportExportTransform,
          lazyImportExportTransform:
            lazyImportsOption === true
              ? (importModuleSpecifier: string) => {
                  // Do not lazy-initialize packages that are local imports (similar to `lazy: true`
                  // behavior) or are in the blacklist.
                  return !(
                    importModuleSpecifier.includes('./') || lazyImports.has(importModuleSpecifier)
                  );
                }
              : // Pass the option directly to `metro-react-native-babel-preset`, which in turn
                // passes it to `babel-plugin-transform-modules-commonjs`
                lazyImportsOption,
        },
      ],
    ],

    plugins: [
      ...extraPlugins,
      // TODO: Remove
      [require.resolve('@babel/plugin-proposal-decorators'), { legacy: true }],
      require.resolve('@babel/plugin-proposal-export-namespace-from'),
      // Automatically add `react-native-reanimated/plugin` when the package is installed.
      // TODO: Move to be a customTransformOption.
      hasModule('react-native-reanimated') &&
        reanimated !== false && [require.resolve('react-native-reanimated/plugin')],
    ].filter(Boolean) as PluginItem[],
  };
}

function getAliasPlugin(): PluginItem | null {
  if (!hasModule('@expo/vector-icons')) {
    return null;
  }
  return [
    require.resolve('babel-plugin-module-resolver'),
    {
      alias: {
        'react-native-vector-icons': '@expo/vector-icons',
      },
    },
  ];
}

function hasModule(name: string): boolean {
  try {
    return !!require.resolve(name);
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes(name)) {
      return false;
    }
    throw error;
  }
}

/** Determine which bundler is being used. */
function getBundler(caller: any) {
  if (!caller) return null;
  if (caller.bundler) return caller.bundler;
  if (caller.name === 'next-babel-turbo-loader' || caller.name === 'babel-loader') {
    // expo/webpack-config, gatsby, storybook, and next.js <10
    // NextJS 11
    return 'webpack';
  }

  // This is a hack to determine if metro is being used.
  return 'metro';
}

export default babelPresetExpo;
module.exports = babelPresetExpo;
