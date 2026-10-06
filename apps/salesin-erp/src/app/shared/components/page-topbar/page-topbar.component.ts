import { Component, computed, inject, input, output, signal } from '@angular/core';
import { LanguageService } from '../../../core/i18n/language.service';

export interface PageTopbarAction {
  id: string;
  label: string;
}

@Component({
  selector: 'app-page-topbar',
  standalone: true,
  templateUrl: './page-topbar.component.html',
  styleUrl: './page-topbar.component.scss',
})
export class PageTopbarComponent {
  readonly title = input.required<string>();
  readonly userName = input.required<string>();
  readonly userImage = input<string | null>(null);
  readonly actions = input<PageTopbarAction[]>([]);
  readonly actionSelected = output<string>();

  protected readonly i18n = inject(LanguageService);
  protected readonly menuOpen = signal(false);
  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected selectAction(actionId: string): void {
    this.menuOpen.set(false);
    this.actionSelected.emit(actionId);
  }
}