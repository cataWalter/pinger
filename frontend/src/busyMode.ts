import { franc } from 'franc-min'

export const ENGLISH_BUSY_REPLY_TEMPLATE = "Hi! I'm the AI assistant for {name}. They're busy right now, but your message has reached them. They'll reply as soon as they can; there may be a delay. Thanks for your patience."

const busyReplyTemplates: Record<string, string> = {
  eng: ENGLISH_BUSY_REPLY_TEMPLATE,
  ara: 'مرحبًا! أنا المساعد الذكي لـ{name}. هو مشغول حاليًا، لكن رسالتك وصلته. سيرد عليك عندما يستطيع، وقد يتأخر قليلًا. شكرًا لتفهمك.',
  cmn: '你好！我是{name}的 AI 助手。对方现在正忙，不过已经收到你的消息，会尽快回复，可能需要一些时间。感谢你的耐心。',
  deu: 'Hallo! Ich bin der KI-Assistent von {name}. Die Person ist gerade beschäftigt, aber deine Nachricht ist angekommen. Sie antwortet, sobald sie kann; es kann etwas dauern. Danke für deine Geduld.',
  ell: 'Γεια σας! Είμαι ο βοηθός τεχνητής νοημοσύνης του/της {name}. Αυτή τη στιγμή είναι απασχολημένος/η, αλλά το μήνυμά σας έφτασε. Θα απαντήσει μόλις μπορέσει· ίσως υπάρξει καθυστέρηση. Ευχαριστώ για την υπομονή σας.',
  fra: 'Bonjour ! Je suis l’assistant IA de {name}. Cette personne est occupée pour le moment, mais votre message lui est bien parvenu. Elle vous répondra dès que possible ; cela peut prendre un peu de temps. Merci de votre patience.',
  hin: 'नमस्ते! मैं {name} का AI सहायक हूँ। वे अभी व्यस्त हैं, लेकिन आपका संदेश उन्हें मिल गया है। वे जल्द से जल्द जवाब देंगे; इसमें थोड़ा समय लग सकता है। धैर्य रखने के लिए धन्यवाद।',
  ita: 'Ciao! Sono l’assistente AI di {name}. In questo momento non può rispondere, ma il tuo messaggio è arrivato. Ti risponderà appena possibile; potrebbe volerci un po’. Grazie per la pazienza.',
  jpn: 'こんにちは。{name}のAIアシスタントです。現在、本人は取り込み中ですが、メッセージは届いています。できるだけ早く返信しますので、少しお待ちいただく場合があります。ご理解ありがとうございます。',
  kor: '안녕하세요. {name}님의 AI 비서입니다. 지금은 바쁘시지만 메시지는 잘 전달되었습니다. 가능한 한 빨리 답장드릴 예정이며, 조금 늦어질 수 있습니다. 양해해 주셔서 감사합니다.',
  nld: 'Hoi! Ik ben de AI-assistent van {name}. Diegene is op dit moment druk, maar je bericht is aangekomen. Er volgt antwoord zodra dat lukt; dat kan even duren. Bedankt voor je geduld.',
  pol: 'Cześć! Jestem asystentem AI {name}. Ta osoba jest teraz zajęta, ale Twoja wiadomość dotarła. Odpowie, gdy tylko będzie mogła; może to chwilę potrwać. Dziękuję za cierpliwość.',
  por: 'Olá! Sou o assistente de IA de {name}. A pessoa está ocupada no momento, mas sua mensagem chegou. Ela responderá assim que puder; pode demorar um pouco. Agradeço a sua paciência.',
  rus: 'Здравствуйте! Я ИИ-ассистент {name}. Сейчас этот человек занят, но ваше сообщение получено. Он ответит, как только сможет; это может занять некоторое время. Спасибо за понимание.',
  spa: '¡Hola! Soy el asistente de IA de {name}. Ahora mismo está ocupado, pero tu mensaje ya llegó. Te responderá en cuanto pueda; puede tardar un poco. Gracias por tu paciencia.',
  tur: 'Merhaba! Ben {name} için çalışan yapay zekâ asistanıyım. Şu anda meşgul, ancak mesajınız ulaştı. Mümkün olan en kısa sürede yanıt verecek; biraz gecikebilir. Sabrınız için teşekkürler.',
  ukr: 'Вітаю! Я ШІ-помічник {name}. Зараз ця людина зайнята, але ваше повідомлення отримано. Вона відповість, щойно зможе; це може зайняти трохи часу. Дякую за терпіння.',
}

export function detectBusyReplyLanguage(messages: string[]) {
  const votes = new Map<string, { count: number; lastIndex: number }>()
  for (const [index, message] of messages.filter((text) => text.trim()).slice(-10).entries()) {
    const language = franc(message, { minLength: 10 })
    if (language === 'und') continue
    const vote = votes.get(language) ?? { count: 0, lastIndex: index }
    vote.count++
    vote.lastIndex = index
    votes.set(language, vote)
  }

  return [...votes.entries()].sort((left, right) => right[1].count - left[1].count || right[1].lastIndex - left[1].lastIndex)[0]?.[0] ?? 'eng'
}

export function hasBusyReplyTemplate(language: string) {
  return Boolean(busyReplyTemplates[language])
}

export function createBusyReplyForLanguage(language: string, displayName: string) {
  const template = busyReplyTemplates[language] ?? busyReplyTemplates.eng
  const name = displayName.trim() || 'the person you contacted'
  return template.replace(/\{name\}/g, () => name)
}

export function createBusyReply(messages: string[], displayName: string) {
  return createBusyReplyForLanguage(detectBusyReplyLanguage(messages), displayName)
}