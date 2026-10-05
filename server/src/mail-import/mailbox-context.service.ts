import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { GraphClient } from '../integrations/microsoft/graph-client.service';
import { MicrosoftAuthService } from '../integrations/microsoft/microsoft-auth.service';
import { GroupCompany } from '../knowledge/entities/group-company.entity';
import { User } from '../users/user.entity';
import { cleanAddress, domainOf, isFreemail, registrableDomain } from './addresses';
import { ScanContext } from './mail-aggregator';
import { ClassifierContext } from './relationship-classifier.service';

/**
 * What every look into a mailbox needs to know first: which addresses are
 * the owner's, which domains belong to the group, and who "we" are for the
 * LLM. Shared by the import and the background sync.
 */
@Injectable()
export class MailboxContext {
  private readonly internalDomains: string[];

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(GroupCompany) private readonly groupCompanies: Repository<GroupCompany>,
    private readonly graph: GraphClient,
    private readonly auth: MicrosoftAuthService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.internalDomains = config.get('mailImport', { infer: true }).internalDomains.map(registrableDomain);
  }

  /** Own addresses and the group's domains: neither ever becomes a customer. */
  async scan(userId: string): Promise<ScanContext> {
    const [me, connection, users] = await Promise.all([
      this.graph.me(userId),
      this.auth.connection(userId),
      this.users.find({ select: { email: true } }),
    ]);
    const own = new Set(
      [
        me.mail,
        me.userPrincipalName,
        connection?.email,
        ...(me.otherMails ?? []),
        // "SMTP:max@acme.de" (primary) and "smtp:alias@acme.de"
        ...(me.proxyAddresses ?? []).filter((a) => /^smtp:/i.test(a)).map((a) => a.slice(5)),
      ]
        .map((a) => cleanAddress(a))
        .filter((a): a is string => !!a),
    );
    // Freemail domains of colleagues must not hide every gmail customer
    const internal = new Set(
      [...own, ...users.map((u) => u.email)]
        .map((a) => registrableDomain(domainOf(a)))
        .filter((d) => d && !isFreemail(d))
        .concat(this.internalDomains),
    );
    return { ownAddresses: own, internalDomains: internal };
  }

  async classifier(userId: string): Promise<ClassifierContext> {
    const [user, connection, companies] = await Promise.all([
      this.users.findOneByOrFail({ id: userId }),
      this.auth.connection(userId),
      this.groupCompanies.find({ order: { name: 'ASC' } }),
    ]);
    return {
      ownerName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      ownerEmail: connection?.email ?? user.email,
      groupCompanies: companies.map((c) => ({ name: c.name, description: c.description })),
    };
  }
}
