import { CanDeactivateFn } from '@angular/router';

/** For pages with work in progress (e.g. running uploads) that should ask before they are left. */
export const canLeaveGuard: CanDeactivateFn<{ canLeave?: () => boolean }> = (component) => component?.canLeave?.() ?? true;
