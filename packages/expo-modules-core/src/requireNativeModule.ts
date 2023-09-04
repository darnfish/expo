import NativeModulesProxy from './NativeModulesProxy';

type ExpoObject = {
  modules:
    | undefined
    | {
        [key: string]: any;
      };
  uuidv4: () => string;
};

declare global {
  // eslint-disable-next-line no-var
  var expo: ExpoObject | undefined;

  /**
   * @deprecated `global.ExpoModules` is deprecated, use `global.expo.modules` instead.
   */
  // eslint-disable-next-line no-var
  var ExpoModules:
    | undefined
    | {
        [key: string]: any;
      };
}

/**
 * Imports the native module registered with given name. In the first place it tries to load
 * the module installed through the JSI host object and then falls back to the bridge proxy module.
 * Notice that the modules loaded from the proxy may not support some features like synchronous functions.
 *
 * @param moduleName Name of the requested native module.
 * @returns Object representing the native module.
 * @throws Error when there is no native module with given name.
 */
export function requireNativeModule<ModuleType = any>(moduleName: string): ModuleType {
  const nativeModule: ModuleType =
    globalThis.expo?.modules?.[moduleName] ??
    globalThis.ExpoModules?.[moduleName] ??
    NativeModulesProxy[moduleName];

  if (!nativeModule) {
    throw new Error(`Cannot find native module '${moduleName}'`);
  }
  return nativeModule;
}
