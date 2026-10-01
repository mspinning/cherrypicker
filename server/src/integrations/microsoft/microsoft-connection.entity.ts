import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

export enum MicrosoftConnectionStatus {
  Active = 'active',
  /** Refresh token revoked or expired: the user has to connect again */
  ReauthRequired = 'reauth_required',
}

/**
 * A user's Microsoft 365 mailbox and calendar, linked via OAuth (delegated
 * permissions). Tokens are encrypted with SecretBox and never leave the server.
 */
@Entity('microsoft_connections')
export class MicrosoftConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** Graph user id; one mailbox belongs to one CRM user only, otherwise its mails would count twice */
  @Index({ unique: true })
  @Column({ name: 'ms_user_id', type: 'varchar', length: 100 })
  msUserId: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 100, nullable: true })
  tenantId: string | null;

  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200, default: '' })
  displayName: string;

  /** Granted delegated scopes, space separated */
  @Column({ type: 'text', default: '' })
  scopes: string;

  @Column({ name: 'refresh_token', type: 'text', select: false })
  refreshToken: string;

  @Column({ name: 'access_token', type: 'text', nullable: true, select: false })
  accessToken: string | null;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz', nullable: true })
  accessTokenExpiresAt: Date | null;

  @Column({
    type: 'enum',
    enum: MicrosoftConnectionStatus,
    enumName: 'microsoft_connection_status',
    default: MicrosoftConnectionStatus.Active,
  })
  status: MicrosoftConnectionStatus;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'connected_at', type: 'timestamptz' })
  connectedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
