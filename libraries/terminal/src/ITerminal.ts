// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import type { ITerminalProvider } from './ITerminalProvider';

/**
 * @beta
 */
export interface IWriteOptions {
  /**
   * If set to true, SGR parameters will not be replaced by the terminal
   * standard (i.e. - red for errors, yellow for warnings).
   */
  doNotOverrideSgrCodes?: boolean;
}

/**
 * @beta
 */
export type WriteParameters = string[] | [...string[], IWriteOptions];

/**
 * @beta
 */
export interface ITerminal {
  /**
   * Subscribe a new terminal provider.
   */
  registerProvider(provider: ITerminalProvider): void;

  /**
   * Unsubscribe a terminal provider. If the provider isn't subscribed, this function does nothing.
   */
  unregisterProvider(provider: ITerminalProvider): void;

  /**
   * Write a generic message to the terminal
   */
  write(...messageParts: WriteParameters): void;

  /**
   * Write a generic message to the terminal, followed by a newline
   */
  writeLine(...messageParts: WriteParameters): void;

  /**
   * Write a warning message to the console with yellow text.
   *
   * @remarks
   * The yellow color takes precedence over any other foreground colors set.
   */
  writeWarning(...messageParts: WriteParameters): void;

  /**
   * Write a warning message to the console with yellow text, followed by a newline.
   *
   * @remarks
   * The yellow color takes precedence over any other foreground colors set.
   */
  writeWarningLine(...messageParts: WriteParameters): void;

  /**
   * Write an error message to the console with red text.
   *
   * @remarks
   * The red color takes precedence over any other foreground colors set.
   */
  writeError(...messageParts: WriteParameters): void;

  /**
   * Write an error message to the console with red text, followed by a newline.
   *
   * @remarks
   * The red color takes precedence over any other foreground colors set.
   */
  writeErrorLine(...messageParts: WriteParameters): void;

  /**
   * Write a verbose-level message.
   */
  writeVerbose(...messageParts: WriteParameters): void;

  /**
   * Write a verbose-level message followed by a newline.
   */
  writeVerboseLine(...messageParts: WriteParameters): void;

  /**
   * Write a debug-level message.
   */
  writeDebug(...messageParts: WriteParameters): void;

  /**
   * Write a debug-level message followed by a newline.
   */
  writeDebugLine(...messageParts: WriteParameters): void;
}
