import { Component, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';

interface QuickAction {
  title: string;
  description: string;
  symbol: string;
}

@Component({
  selector: 'app-home',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    RouterLinkActive,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly userInitial = computed(() => this.userName().slice(0, 1).toUpperCase());
  protected readonly userMenuOpen = signal(false);
  protected readonly passwordDialogOpen = signal(false);
  protected readonly passwordLoading = signal(false);
  protected readonly resetLoading = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordSuccess = signal(false);
  protected readonly today = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

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

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected openPasswordDialog(): void {
    this.userMenuOpen.set(false);
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
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
