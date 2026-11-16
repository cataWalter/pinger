export function fuzzyScore(query: string, target: string) {
  const queryCharacters = [...query.toLowerCase()]
  const targetCharacters = [...target.toLowerCase()]
  if (queryCharacters.length === 0) return 0
  let queryIndex = 0
  let score = 0
  let lastIndex = -2
  for (let index = 0; index < targetCharacters.length; index++) {
    const character = targetCharacters[index]
    if (character !== queryCharacters[queryIndex]) continue
    score += 10
    if (index === 0 || [' ', ':', '_', '-'].includes(targetCharacters[index - 1])) score += 8
    if (index === lastIndex + 1) score += 5
    lastIndex = index
    queryIndex++
    if (queryIndex === queryCharacters.length) return score - targetCharacters.length + queryCharacters.length
  }
  return null
}
