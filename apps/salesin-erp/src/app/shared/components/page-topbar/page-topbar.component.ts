import { Component, computed, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { SidebarStateService } from '../sidebar/sidebar-state.service';

export interface PageTopbarAction {
  id: string;
  label: string;
}

@Component({
  selector: 'app-page-topbar',
  templateUrl: './page-topbar.component.html',
  styleUrl: './page-topbar.component.scss',
})
export class PageTopbarComponent {
  readonly title = input.required<string>();
  readonly userName = input.required<string>();
  readonly userImage = input<string | null>(null);
  readonly actions = input<PageTopbarAction[]>([]);
  /** Hidden when the sidebar is docked and always visible. */
  readonly showMenuButton = input(true);
  readonly actionSelected = output<string>();

  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly sidebarState = inject(SidebarStateService);
  protected readonly menuOpen = signal(false);
  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected selectAction(actionId: string): void {
    this.menuOpen.set(false);
    this.actionSelected.emit(actionId);
  }

  @HostListener('document:click', ['$event'])
  protected closeOnOutsideClick(event: MouseEvent): void {
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected closeOnEscape(): void {
    this.menuOpen.set(false);
  }
}
