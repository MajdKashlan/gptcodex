import { Directionality } from '@angular/cdk/bidi';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { parseFrappeError } from './frappe-error';

/**
 * Single place for user-facing feedback.
 *
 * Before this existed, four feature components each carried their own copy of the
 * `_server_messages` parsing and rendered the result inline. Call sites should use
 * this service and may still keep the returned string inline next to a form.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly directionality = inject(Directionality, { optional: true });

  success(message: string, durationMs = 3000): void {
    this.open(message, 'app-notification-success', durationMs);
  }

  info(message: string, durationMs = 4500): void {
    this.open(message, 'app-notification-info', durationMs);
  }

  /**
   * Surfaces a Frappe/HTTP failure and returns the primary plain-text message so
   * the caller can also display it inline.
   */
  error(error: unknown, durationMs = 6000): string {
    const info = parseFrappeError(error);
    this.open(info.message, 'app-notification-error', durationMs);
    return info.message;
  }

  private open(message: string, panelClass: string, durationMs: number): void {
    const direction = this.directionality?.value;

    this.snackBar.open(message, undefined, {
      duration: durationMs,
      panelClass: [panelClass],
      verticalPosition: 'bottom',
      horizontalPosition: 'center',
      ...(direction === undefined ? {} : { direction }),
    });
  }
}