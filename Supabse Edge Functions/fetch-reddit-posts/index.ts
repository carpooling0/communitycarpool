import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.19'

const supabase = createClient(Deno.env.get('DB_URL')!, Deno.env.get('DB_SERVICE_KEY')!)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

const MIN_RELEVANCE = 6

async function callBedrock(prompt: string): Promise<string> {
  const region = Deno.env.get('AWS_BEDROCK_REGION') || 'eu-west-1'
  const aws = new AwsClient({
    accessKeyId: Deno.env.get('AWS_BEDROCK_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('AWS_BEDROCK_SECRET_ACCESS_KEY')!,
    region,
    service: 'bedrock'
  })

  const modelId = 'anthropic.claude-3-haiku-20240307-v1:0'
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })

  const res = await aws.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Bedrock error ${res.status}: ${errText}`)
  }

  const json = await res.json()
  return json.content[0].text
}

async function analysePost(post: any, subreddit: string): Promise<any> {
  const prompt = `You are drafting Reddit replies for someone who built a free carpooling platform called CommunityCarpool.org. It matches commuters globally based on route compatibility. They want to be a genuine, helpful voice in commuting and sustainability communities, not a spammer. Most moderators will delete overtly promotional posts, so replies should feel like a real person talking, not marketing.

Analyse this Reddit post and return ONLY valid JSON, no other text.

Subreddit: r/${subreddit}
Title: ${post.title}
Body: ${(post.selftext || '').slice(0, 500)}

Return this exact JSON:
{
  "relevance_score": <integer 1-10, how relevant is this for the platform to engage with>,
  "intent": <one of: "discussion" | "complaint" | "advice-seeking" | "informational">,
  "reply_a": <helpful reply, no mention of CommunityCarpool at all, max 100 words, casual Reddit tone, no bullet points, no em-dashes>,
  "reply_b": <helpful reply that weaves in a brief natural mention of communitycarpool.org, max 100 words, no bullet points, no em-dashes, reads like a person not a brand>,
  "reply_c": <reply that mentions communitycarpool.org more directly, only appropriate when the post is specifically asking for carpooling or commuting solutions, max 100 words, no bullet points, no em-dashes>
}

Rules:
- Write like a knowledgeable person, not a company
- No em-dashes anywhere in any reply
- No bullet points
- Keep it conversational and concise
- For reply_b: the mention should feel incidental, not like the point of the reply
- For reply_c: phrase it as something like "I actually built something for this" rather than leading with the brand name
- reply_c is only appropriate when the post directly asks for carpooling or commuting tools`

  const raw = await callBedrock(prompt)
  return JSON.parse(raw.trim())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const candidates: Array<{ subreddit: string; post: any }> = body.posts || []

    let processed = 0
    let inserted = 0
    let skippedLowRelevance = 0
    let bedrockError: string | null = null

    for (const { subreddit, post } of candidates) {
      const { data: existing } = await supabase
        .from('reddit_digest')
        .select('id')
        .eq('post_id', post.id)
        .single()
      if (existing) continue

      processed++

      if (bedrockError) continue

      let analysis: any = null
      try {
        analysis = await analysePost(post, subreddit)
      } catch (err: any) {
        bedrockError = err.message
        continue
      }
      if (!analysis) continue
      if (analysis.relevance_score < MIN_RELEVANCE) { skippedLowRelevance++; continue }

      const { error } = await supabase.from('reddit_digest').insert({
        subreddit,
        post_id: post.id,
        post_title: post.title,
        post_body: (post.selftext || '').slice(0, 1000),
        post_url: `https://www.reddit.com${post.permalink}`,
        post_score: post.score,
        post_created_at: new Date(post.created_utc * 1000).toISOString(),
        comment_count: post.num_comments,
        relevance_score: analysis.relevance_score,
        intent: analysis.intent,
        reply_a: analysis.reply_a,
        reply_b: analysis.reply_b,
        reply_c: analysis.reply_c,
        status: 'pending'
      })

      if (!error) inserted++
    }

    return new Response(JSON.stringify({ success: true, processed, inserted, skippedLowRelevance, bedrockError }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('fetch-reddit-posts error:', err)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    })
  }
})
