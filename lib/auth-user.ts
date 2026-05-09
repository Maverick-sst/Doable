import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function requireDbUser() {
  const { userId } = await auth()
  if (!userId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  let user = await prisma.user.findUnique({ where: { clerkId: userId } })

  // retry briefly for webhook lag
  if (!user) {
    await wait(300)
    user = await prisma.user.findUnique({ where: { clerkId: userId } })
  }

  // fallback self-heal from Clerk
  if (!user) {
    const client = await clerkClient()
    const clerkUser = await client.users.getUser(userId)
    const email = clerkUser.emailAddresses[0]?.emailAddress

    if (!email) {
      return {
        error: NextResponse.json(
          { error: 'User sync failed: Clerk user has no email' },
          { status: 503 }
        ),
      }
    }

    user = await prisma.user.upsert({
      where: { clerkId: userId },
      update: { email },
      create: { clerkId: userId, email },
    })
  }

  return { user }
}
