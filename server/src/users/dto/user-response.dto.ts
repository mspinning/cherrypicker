import { User } from '../user.entity';

export class UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  createdAt: Date;

  static from(user: User, roles: string[] = []): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      createdAt: user.createdAt,
    };
  }
}
