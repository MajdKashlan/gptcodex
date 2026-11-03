import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { formatMoney } from '../../core/utils/format';
import { QtyPipe } from '../../shared/pipes/format.pipes';
import { DashboardData, DashboardTrendPoint, HomeDashboardService } from './home-dashboard.service';

interface DashboardChartPoint extends DashboardTrendPoint {
  x: number;
  y: number;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink, QtyPipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly dashboardService = inject(HomeDashboardService);

  protected readonly firstName = computed(() => (this.auth.currentUser()?.fullName || '').split(' ')[0]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly dashboard = signal<DashboardData | null>(null);
  protected readonly trendRange = signal<7 | 30 | 90>(30);
  protected readonly activeTrendPoint = signal<DashboardTrendPoint | null>(null);
  protected readonly today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date());

  protected readonly chartPoints = computed<DashboardChartPoint[]>(() => {
    const points = (this.dashboard()?.salesTrend ?? []).slice(-this.trendRange());
    const max = Math.max(1, ...points.map((point) => point.total));
    return points.map((point, index) => ({
      ...point,
      x: points.length < 2 ? 360 : 32 + index * (656 / (points.length - 1)),
      y: 218 - (point.total / max) * 164,
    }));
  });
  protected readonly chartLine = computed(() => this.chartPoints().map((p) => `${p.x},${p.y}`).join(' '));
  protected readonly chartArea = computed(() => {
    const points = this.chartPoints();
    if (!points.length) return '';
    return `M ${points[0].x},218 L ${points.map((p) => `${p.x},${p.y}`).join(' L ')} L ${points[points.length - 1].x},218 Z`;
  });
  protected readonly trendTotal = computed(() => this.chartPoints().reduce((sum, p) => sum + p.total, 0));
  protected readonly trendOrderCount = computed(() => this.chartPoints().reduce((sum, p) => sum + p.orderCount, 0));

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.dashboardService
      .load()
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => this.dashboard.set(data),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  protected money(value: number): string {
    return formatMoney(value, this.dashboard()?.currency);
  }

  protected setTrendRange(range: 7 | 30 | 90): void {
    this.trendRange.set(range);
    this.activeTrendPoint.set(null);
  }

  protected inspectTrendPoint(point: DashboardTrendPoint): void {
    this.activeTrendPoint.set(point);
  }
}
