import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  host: { '[class.sales-expanded]': 'salesExpanded()' },
})
export class SidebarComponent {
  readonly userName = input.required<string>();
  readonly userImage = input<string | null>(null);
  readonly signOut = output<void>();

  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());
  protected readonly salesExpanded = signal(false);
}