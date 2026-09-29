import { User, UserRole } from '../user.entity';

export class UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** false until an admin has approved the account */
  approved: boolean;
  approvedAt: Date | null;
  createdAt: Date;

  static from(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      approved: user.approvedAt !== null,
      approvedAt: user.approvedAt,
      createdAt: user.createdAt,
    };
  }
}
