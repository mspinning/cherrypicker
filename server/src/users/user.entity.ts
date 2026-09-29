import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  User = 'user',
  Admin = 'admin',
}

/**
 * Local CRM profile of a user. Credentials live exclusively in Keycloak;
 * `keycloakId` links this row to the Keycloak user (token `sub`).
 * Role and approval are decided by the CRM, not by Keycloak.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'keycloak_id', type: 'uuid' })
  keycloakId: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role', default: UserRole.User })
  role: UserRole;

  /** Set once an admin approves the account. Until then the user cannot sign in. */
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
