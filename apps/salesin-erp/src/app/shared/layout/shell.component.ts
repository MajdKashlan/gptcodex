import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, finalize, fromEvent, map, merge, startWith, switchMap, throttleTime, timer } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { AppContextService } from '../../core/context/app-context.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { NotificationService } from '../../core/http/notification.service';
import { ConfirmService } from '../components/confirm-dialog/confirm.service';
import { PageTopbarAction, PageTopbarComponent } from '../components/page-topbar/page-topbar.component';
import { SidebarStateService } from '../components/sidebar/sidebar-state.service';
import { SidebarComponent } from '../components/sidebar/sidebar.component';

const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Authenticated application frame: navigation, top bar, account actions and the
 * idle sign-out. Feature pages render inside the outlet and contain only their own
 * content, so none of them repeats session restore, logout or layout code.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent implements OnInit {
  private readonly auth = inject(ErpNextAuthService);
  private readonly appContext = inject(AppContextService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly sidebarState = inject(SidebarStateService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly docked = toSignal(
    inject(BreakpointObserver).observe('(min-width: 1200px)').pipe(map((state) => state.matches)),
    { initialValue: false },
  );
  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl ?? null);
  protected readonly title = signal('');
  protected readonly topbarActions: PageTopbarAction[] = [
    { id: 'change-password', label: 'Change password' },
    { id: 'logout', label: 'Log out' },
  ];

  protected readonly passwordDialogOpen = signal(false);
  protected readonly passwordLoading = signal(false);
  protected readonly resetLoading = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordSuccess = signal<string | null>(null);
  protected readonly passwordForm = this.formBuilder.nonNullable.group({
    oldPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  ngOnInit(): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        let child = this.route.snapshot;
        while (child.firstChild) child = child.firstChild;
        this.title.set(child.title ?? '');
        if (!this.docked()) this.sidebarState.close();
      });

    merge(
      fromEvent(document, 'pointerdown'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'wheel'),
      fromEvent(document, 'touchstart'),
      fromEvent(document, 'pointermove').pipe(throttleTime(5000)),
    )
      .pipe(
        startWith(null),
        switchMap(() => timer(IDLE_TIMEOUT_MS)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.notifications.info('You were signed out after 1 hour of inactivity.');
        this.performSignOut();
      });
  }

  protected handleTopbarAction(actionId: string): void {
    if (actionId === 'change-password') this.openPasswordDialog();
    if (actionId === 'logout') this.askSignOut();
  }

  protected askSignOut(): void {
    this.confirm
      .ask({ title: 'Log out?', message: 'You will need to sign in again to use SalesIn.', confirmLabel: 'Log out' })
      .subscribe((ok) => {
        if (ok) this.performSignOut();
      });
  }

  private performSignOut(): void {
    this.auth.logout().subscribe(() => {
      this.appContext.reset();
      void this.router.navigate(['/login']);
    });
  }

  protected openPasswordDialog(): void {
    this.passwordError.set(null);
    this.passwordSuccess.set(null);
    this.passwordForm.reset();
    this.passwordDialogOpen.set(true);
  }

  protected closePasswordDialog(): void {
    if (!this.passwordLoading() && !this.resetLoading()) this.passwordDialogOpen.set(false);
  }

  protected changePassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    const { oldPassword, newPassword, confirmPassword } = this.passwordForm.getRawValue();
    if (oldPassword === newPassword) {
      this.passwordError.set('New password must be different from the current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.passwordError.set('New password and confirmation do not match.');
      return;
    }
    this.passwordLoading.set(true);
    this.passwordError.set(null);
    this.auth
      .changePassword({ oldPassword, newPassword })
      .pipe(finalize(() => this.passwordLoading.set(false)))
      .subscribe({
        next: () => {
          this.passwordSuccess.set('Your password was changed successfully.');
          this.passwordForm.reset();
        },
        error: (error: unknown) => this.passwordError.set(frappeErrorMessage(error)),
      });
  }

  protected requestPasswordReset(): void {
    const username = this.auth.currentUser()?.username;
    if (!username) {
      this.passwordError.set('Your user account could not be identified. Please sign in again.');
      return;
    }
    this.resetLoading.set(true);
    this.passwordError.set(null);
    this.auth
      .requestPasswordReset(username)
      .pipe(finalize(() => this.resetLoading.set(false)))
      .subscribe({
        next: () => this.passwordSuccess.set('A password reset link was sent to your email address.'),
        error: (error: unknown) => this.passwordError.set(frappeErrorMessage(error)),
      });
  }
}
