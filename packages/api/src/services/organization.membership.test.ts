import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nanoid } from 'nanoid'
import { createTestDb, type TestDbHandle } from '../test-utils/db'
import { users } from '../db/schema'
import { OrganizationService } from './organization.service'
import { MembershipService } from './membership.service'
import { Role } from '../auth/permissions'

let h: TestDbHandle
let orgs: OrganizationService
let members: MembershipService

async function makeUser(email: string): Promise<string> {
  const id = nanoid()
  await h.db.insert(users).values({ id, email: email.toLowerCase(), passwordHash: 'x' })
  return id
}

beforeEach(() => {
  h = createTestDb()
  orgs = new OrganizationService({ db: h.db })
  members = new MembershipService({ db: h.db })
})
afterEach(() => h.close())

describe('OrganizationService', () => {
  it('creates a personal org with the creator as active owner', async () => {
    const uid = await makeUser('alice@example.com')
    const org = await orgs.createPersonalOrganization(uid, 'Alice')

    expect(org.isPersonal).toBe(true)
    expect(org.slug).toMatch(/workspace/)
    const membership = await members.getMembership(uid, org.id)
    expect(membership?.role).toBe(Role.ORG_OWNER)
    expect(membership?.status).toBe('active')
  })

  it('generates a unique slug when two orgs share a name', async () => {
    const uid = await makeUser('alice@example.com')
    const a = await orgs.createOrganization({ name: 'Acme', ownerId: uid })
    const b = await orgs.createOrganization({ name: 'Acme', ownerId: uid })
    expect(a.slug).toBe('acme')
    expect(b.slug).not.toBe(a.slug)
  })

  it('lists memberships and prefers the personal org as default', async () => {
    const uid = await makeUser('alice@example.com')
    const personal = await orgs.createPersonalOrganization(uid, 'Alice')
    await orgs.createOrganization({ name: 'Team', ownerId: uid })

    const mine = await orgs.listUserOrganizations(uid)
    expect(mine).toHaveLength(2)
    expect(await orgs.getDefaultOrganizationId(uid)).toBe(personal.id)
  })

  it('returns null default when the user has no org', async () => {
    const uid = await makeUser('nobody@example.com')
    expect(await orgs.getDefaultOrganizationId(uid)).toBeNull()
  })
})

describe('MembershipService', () => {
  it('adds members, defaults to member role, and blocks duplicates', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await orgs.createOrganization({ name: 'Acme', ownerId: owner })
    const bob = await makeUser('bob@example.com')

    const m = await members.addMember({ organizationId: org.id, userId: bob })
    expect(m.role).toBe(Role.ORG_MEMBER)
    await expect(members.addMember({ organizationId: org.id, userId: bob })).rejects.toThrow(/already a member/)

    const list = await members.listMembers(org.id)
    expect(list).toHaveLength(2) // owner + bob
    expect(list.map((x) => x.email).sort()).toEqual(['bob@example.com', 'owner@example.com'])
  })

  it('changes a role and guards the last owner', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await orgs.createOrganization({ name: 'Acme', ownerId: owner })
    const bob = await makeUser('bob@example.com')
    await members.addMember({ organizationId: org.id, userId: bob, role: Role.ORG_MEMBER })

    const promoted = await members.changeRole({ organizationId: org.id, userId: bob, role: Role.ORG_ADMIN })
    expect(promoted.role).toBe(Role.ORG_ADMIN)

    // demoting the only owner must fail
    await expect(
      members.changeRole({ organizationId: org.id, userId: owner, role: Role.ORG_ADMIN }),
    ).rejects.toThrow(/last owner/)
  })

  it('removes a member but refuses to remove the last owner', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await orgs.createOrganization({ name: 'Acme', ownerId: owner })
    const bob = await makeUser('bob@example.com')
    await members.addMember({ organizationId: org.id, userId: bob })

    await members.removeMember({ organizationId: org.id, userId: bob })
    expect(await members.getMembership(bob, org.id)).toBeNull()

    await expect(members.removeMember({ organizationId: org.id, userId: owner })).rejects.toThrow(/last owner/)
  })

  it('invites an existing user and lets them accept', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await orgs.createOrganization({ name: 'Acme', ownerId: owner })
    const carol = await makeUser('carol@example.com')

    const { invitationToken } = await members.invite({
      organizationId: org.id,
      email: 'carol@example.com',
      role: Role.ORG_ADMIN,
      invitedBy: owner,
    })
    const pending = await members.getMembership(carol, org.id)
    expect(pending?.status).toBe('invited')
    expect(await members.isActiveMember(carol, org.id)).toBe(false)

    const accepted = await members.acceptInvite({ userId: carol, invitationToken })
    expect(accepted.status).toBe('active')
    expect(accepted.invitationToken).toBeNull()
    expect(await members.isActiveMember(carol, org.id)).toBe(true)
  })

  it('rejects invites for unknown emails', async () => {
    const owner = await makeUser('owner@example.com')
    const org = await orgs.createOrganization({ name: 'Acme', ownerId: owner })
    await expect(
      members.invite({ organizationId: org.id, email: 'ghost@example.com', invitedBy: owner }),
    ).rejects.toThrow(/No account/)
  })
})
