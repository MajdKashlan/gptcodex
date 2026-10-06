import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize, fromEvent, merge, startWith, switchMap, timer } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { PageTopbarAction, PageTopbarComponent } from '../../shared/components/page-topbar/page-topbar.component';
import { DashboardData, DashboardTrendPoint, HomeDashboardService } from './home-dashboard.service';

interface QuickAction {
  title: string;
  description: string;
  symbol: string;
}

interface DashboardChartPoint extends DashboardTrendPoint {
  x: number;
  y: number;
}

@Component({
  selector: 'app-home',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    SidebarComponent,
    PageTopbarComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  private static readonly idleTimeoutMs = 60 * 60 * 1000;
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dashboardService = inject(HomeDashboardService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly topbarActions: PageTopbarAction[] = [
    { id: 'change-password', label: 'Change password' },
    { id: 'logout', label: 'Logout' },
  ];
  protected readonly passwordDialogOpen = signal(false);
  protected readonly passwordLoading = signal(false);
  protected readonly resetLoading = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordSuccess = signal(false);
  protected readonly dashboardLoading = signal(true);
  protected readonly trendRange = signal<7 | 30 | 90>(30);
  protected readonly activeTrendPoint = signal<DashboardTrendPoint | null>(null);
  protected readonly dashboardError = signal<string | null>(null);
  protected readonly logoutError = signal<string | null>(null);
  protected readonly logoutConfirmationOpen = signal(false);
  protected readonly logoutLoading = signal(false);
  protected readonly dashboard = signal<DashboardData>({
    salesOrderCount: 0,
    openOrderCount: 0,
    closedOrderCount: 0,
    totalSales: 0,
    customerCount: 0,
    itemCount: 0,
    topCustomers: [],
    popularItems: [],
    salesTrend: [],
    unavailableResources: [],
  });
  protected readonly today = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
  protected readonly chartPoints = computed<DashboardChartPoint[]>(() => {
    const points = this.dashboard().salesTrend.slice(-this.trendRange());
    const max = Math.max(1, ...points.map((point) => point.total));
    return points.map((point, index) => ({
      ...point,
      x: points.length < 2 ? 360 : 32 + index * (656 / (points.length - 1)),
      y: 218 - point.total / max * 164,
    }));
  });
  protected readonly chartLine = computed(() => this.chartPoints().map((point) => `${point.x},${point.y}`).join(' '));
  protected readonly chartArea = computed(() => {
    const points = this.chartPoints();
    if (!points.length) return '';
    return `M ${points[0].x},218 L ${points.map((point) => `${point.x},${point.y}`).join(' L ')} L ${points[points.length - 1].x},218 Z`;
  });
  protected readonly trendTotal = computed(() => this.chartPoints().reduce((total, point) => total + point.total, 0));
  protected readonly trendOrderCount = computed(() => this.chartPoints().reduce((total, point) => total + point.orderCount, 0));

  protected readonly quickActions: QuickAction[] = [
    { title: 'New sales order', description: 'Create an order for a customer', symbol: '+' },
    { title: 'Customers', description: 'Find and manage customer accounts', symbol: '◎' },
    { title: 'Item catalog', description: 'Browse inventory and pricing', symbol: '□' },
  ];

  protected readonly passwordForm = this.formBuilder.nonNullable.group({
    oldPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  ngOnInit(): void {
    if (this.auth.isAuthenticated()) {
      this.startIdleLogoutTimer();
      this.loadDashboard();
      return;
    }

    this.auth.restoreAuthentication().subscribe({
      next: () => {
        this.startIdleLogoutTimer();
        this.loadDashboard();
      },
      error: () => void this.router.navigate(['/login']),
    });
  }

  private startIdleLogoutTimer(): void {
    const activityEvents = merge(
      fromEvent(document, 'pointerdown'),
      fromEvent(document, 'pointermove'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'wheel'),
      fromEvent(document, 'touchstart'),
    );

    activityEvents
      .pipe(
        startWith(null),
        switchMap(() => timer(HomeComponent.idleTimeoutMs)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.performSignOut());
  }

  private loadDashboard(): void {
    this.dashboardService.load()
      .pipe(finalize(() => this.dashboardLoading.set(false)))
      .subscribe({
        next: (data) => this.dashboard.set(data),
        error: () => this.dashboardError.set('Dashboard data could not be loaded. Check your ERPNext permissions.'),
      });
  }

  protected formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  }

  protected setTrendRange(range: 7 | 30 | 90): void {
    this.trendRange.set(range);
    this.activeTrendPoint.set(null);
  }

  protected inspectTrendPoint(point: DashboardTrendPoint): void {
    this.activeTrendPoint.set(point);
  }

  protected handleTopbarAction(actionId: string): void {
    if (actionId === 'change-password') {
      this.openPasswordDialog();
    } else if (actionId === 'logout') {
      this.signOut();
    }
  }

  protected openPasswordDialog(): void {
    this.passwordError.set(null);
    this.passwordSuccess.set(false);
    this.passwordForm.reset();
    this.passwordDialogOpen.set(true);
  }

  protected closePasswordDialog(): void {
    if (!this.passwordLoading()) {
      this.passwordDialogOpen.set(false);
    }
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
          this.passwordSuccess.set(true);
          this.passwordForm.reset();
        },
        error: (error: unknown) => this.passwordError.set(this.passwordErrorMessage(error)),
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
        next: () => {
          this.passwordSuccess.set(true);
          this.passwordForm.reset();
        },
        error: (error: unknown) => this.passwordError.set(this.passwordErrorMessage(error)),
      });
  }

  private passwordErrorMessage(error: unknown): string {
    const serverMessages = (error as { error?: { _server_messages?: string } }).error?._server_messages;
    if (serverMessages) {
      try {
        const messages = JSON.parse(serverMessages) as string[];
        const message = messages
          .map((entry) => {
            try {
              return (JSON.parse(entry) as { message?: string }).message;
            } catch {
              return entry;
            }
          })
          .find((message): message is string => Boolean(message));
        if (message) {
          return message.replace(/<[^>]+>/g, '');
        }
      } catch {
        return 'Unable to change password. Check the current password and try again.';
      }
    }

    return 'Unable to change password. Check the current password and try again.';
  }

  protected signOut(): void {
    this.logoutError.set(null);
    this.logoutConfirmationOpen.set(true);
  }

  protected cancelSignOut(): void {
    if (!this.logoutLoading()) {
      this.logoutConfirmationOpen.set(false);
    }
  }

  protected confirmSignOut(): void {
    this.performSignOut();
  }

  private performSignOut(): void {
    this.logoutError.set(null);
    this.logoutLoading.set(true);
    this.auth.logout().subscribe({
      next: () => {
        this.logoutConfirmationOpen.set(false);
        void this.router.navigate(['/login']);
      },
      error: () => {
        this.logoutError.set('Could not log out from ERPNext. Check your connection and try again.');
        this.logoutLoading.set(false);
      },
    });
  }
}
