import { NextResponse } from "next/server"

export default async function proxy(request: Request) {
	// Local mode: bypass all auth checks
	return NextResponse.next()
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|images|icon.png|monitoring|opengraph-image.png|bg-rectangle.png|onboarding|ingest|login|api/emails).*)",
	],
}
