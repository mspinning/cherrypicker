import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UserAdminService } from '../../core/users/user-admin.service';
import { Icon } from '../../shared/icon';

/** Admin settings: frame with one tab per area (users, knowledge sources). */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Icon],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly userAdmin = inject(UserAdminService);

  readonly pendingCount = computed(() => this.userAdmin.pending().length);
}
