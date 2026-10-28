// Cargo dentro do grupo (Cargos e permissões › "Onde vale"): limita quais
// pastas do grupo os membros com aquele cargo veem. Regra única usada nas
// permissões, na listagem de pastas e em quem recebe as chaves de cada pasta.

/** O membro do grupo enxerga esta pasta do grupo? */
export function memberSeesFolder({ isOwner, scope, folderId }) {
  if (isOwner || !scope || !scope.folderIds?.length) return true;
  return scope.folderIds.includes(folderId);
}

export const scopeKey = (roleKey, teamId) => `${roleKey}:${teamId}`;
