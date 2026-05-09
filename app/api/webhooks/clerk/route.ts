// Clerk calls this endpoint when a user is created/deleted
// We sync that into our own DB so we can relate projects/files to users

import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { WebhookEvent } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
  console.log("webhook triggered!")
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET
  if (!WEBHOOK_SECRET) throw new Error('Missing CLERK_WEBHOOK_SECRET')

  const headerPayload = await headers()
  const svix_id = headerPayload.get('svix-id')
  const svix_timestamp = headerPayload.get('svix-timestamp')
  const svix_signature = headerPayload.get('svix-signature')

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Missing svix headers', { status: 400 })
  }

  const body = await req.text()

  const wh = new Webhook(WEBHOOK_SECRET)
  let evt: WebhookEvent

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent
  } catch {
    return new Response('Invalid webhook signature', { status: 400 })
  }

  if (evt.type === 'user.created') {
    try {
      const email = evt.data.email_addresses?.[0]?.email_address

      if (!email) {
        return new Response('Missing user email from Clerk payload', { status: 400 })
      }

      await prisma.user.upsert({
        where: { clerkId: evt.data.id },
        create: {
          clerkId: evt.data.id,
          email,
        },
        update: {
          email,
        },
      })

      console.log('User upserted in DB:', evt.data.id)
    } catch (error) {
      console.error('Prisma Error:', error)
      return new Response('DB error', { status: 500 })
    }
  }


  if (evt.type === 'user.deleted') {
    await prisma.user.deleteMany({
      where: { clerkId: evt.data.id },
    })
  }

  return new Response('OK', { status: 200 })
}