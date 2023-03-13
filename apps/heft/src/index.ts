// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

export {
  HeftConfiguration,
  type IHeftConfigurationInitializationOptions as _IHeftConfigurationInitializationOptions
} from './configuration/HeftConfiguration';

export type { IRigPackageResolver } from './configuration/RigPackageResolver';

export type { IHeftPlugin, IHeftTaskPlugin, IHeftLifecyclePlugin } from './pluginFramework/IHeftPlugin';

export {
  CancellationTokenSource,
  CancellationToken,
  type ICancellationTokenSourceOptions,
  type ICancellationTokenOptions as _ICancellationTokenOptions
} from './pluginFramework/CancellationToken';

export type { IHeftParameters, IHeftDefaultParameters } from './pluginFramework/HeftParameterManager';

export type {
  IHeftLifecycleSession,
  IHeftLifecycleHooks,
  IHeftLifecycleCleanHookOptions,
  IHeftLifecycleToolStartHookOptions,
  IHeftLifecycleToolFinishHookOptions
} from './pluginFramework/HeftLifecycleSession';

export type {
  IHeftTaskSession,
  IHeftTaskHooks,
  IHeftTaskFileOperations,
  IHeftTaskRunHookOptions,
  IHeftTaskRunIncrementalHookOptions
} from './pluginFramework/HeftTaskSession';

export type { ICopyOperation, IIncrementalCopyOperation } from './plugins/CopyFilesPlugin';

export type { IDeleteOperation } from './plugins/DeleteFilesPlugin';

export type { IRunScript, IRunScriptOptions } from './plugins/RunScriptPlugin';

export type { IFileSelectionSpecifier, IGlobOptions, GlobFn, WatchGlobFn } from './plugins/FileGlobSpecifier';

export type { IWatchedFileState } from './utilities/WatchFileSystemAdapter';

export {
  type IHeftRecordMetricsHookOptions,
  type IMetricsData,
  type IPerformanceData as _IPerformanceData,
  MetricsCollector as _MetricsCollector
} from './metrics/MetricsCollector';

export type { IScopedLogger } from './pluginFramework/logging/ScopedLogger';

// Re-export types required to use custom command-line parameters
export type {
  CommandLineParameter,
  CommandLineChoiceListParameter,
  CommandLineChoiceParameter,
  CommandLineFlagParameter,
  CommandLineIntegerListParameter,
  CommandLineIntegerParameter,
  CommandLineStringListParameter,
  CommandLineStringParameter
} from '@rushstack/ts-command-line';
