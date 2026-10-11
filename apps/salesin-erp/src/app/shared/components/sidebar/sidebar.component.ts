import { Component, computed, HostListener, inject, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LanguageService } from '../../../core/i18n/language.service';
import { SidebarStateService } from './sidebar-state.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  host: {
    '[class.is-open]': 'sidebarState.isOpen()',
  },
})
export class SidebarComponent {
  readonly userName = input.required<string>();
  readonly userImage = input<string | null>(null);
  readonly signOut = output<void>();

  protected readonly i18n = inject(LanguageService);
  protected readonly sidebarState = inject(SidebarStateService);
  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());
  protected readonly salesExpanded = signal(false);

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.sidebarState.close();
  }

  /** Label of the language toggle: shows the language you would switch to. */
  protected readonly languageToggleLabel = computed(() =>
    this.i18n.current() === 'ar' ? 'EN' : 'ع',
  );
}