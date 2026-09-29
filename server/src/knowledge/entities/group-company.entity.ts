import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * A company of our own group. Sales works across the group, so agents need
 * to know which company offers what; its knowledge sources hang off this row.
 */
@Entity('group_companies')
export class GroupCompany {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 120 })
  name: string;

  /** One or two sentences on what the company does; agents use it to pick the right company. */
  @Column({ type: 'text', default: '' })
  description: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
