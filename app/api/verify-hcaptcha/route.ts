import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const token = body.token;

  const secret = process.env.HCAPTCHA_SECRET;

  const response = await fetch("https://api.hcaptcha.com/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      secret: secret!,
      response: token,
    }),
  });

  const data = await response.json();

  return NextResponse.json(data);
}
