import { redirect } from 'next/navigation'
import { buildDesignPath, parseDesignParams } from '@/lib/design-params'

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function Room3DPage({ searchParams }: Props) {
  redirect(buildDesignPath('/studio', parseDesignParams(await searchParams)))
}
