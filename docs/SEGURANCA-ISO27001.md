# Controles técnicos e ISO/IEC 27001:2022

A certificação ISO 27001 é concedida à **organização** que opera um Sistema de Gestão de Segurança da Informação (SGSI), por um organismo certificador. Um software não é certificado por ela. Este documento mostra quais controles técnicos do Anexo A o VaultGuard atende e o que continua sendo responsabilidade de quem o opera.

## Controles atendidos pelo software

| Controle | Como é atendido |
|---|---|
| 5.15, 5.18, 8.2, 8.3 Controle e direitos de acesso | Cargos, grupos e permissões por pasta; privilégios administrativos separados; revisão possível pela auditoria |
| 5.17, 8.5 Autenticação segura | bcrypt custo 12, mínimo de 12 caracteres, histórico, expiração, bloqueio por tentativas, 2FA (TOTP) global, por pessoa ou por grupo, AD/LDAP |
| 8.11, 8.12 Mascaramento e prevenção de vazamento | Senhas mascaradas na tela, exportação controlada por cargo, rota pública sem dados de política |
| 8.15 Registro de eventos | Auditoria com encadeamento HMAC-SHA256: alteração ou remoção no meio da sequência é detectada (`Verificar integridade`) |
| 8.10 Exclusão de informação | Lixeira com prazo e retenção configurável da auditoria |
| 8.13 Backup | `scripts/backup.sh`: banco e anexos cifrados com AES-256, verificados e com retenção |
| 8.20, 8.21 Segurança de redes e serviços | TLS 1.2/1.3 só com cifras AEAD, HSTS, limite de requisições, lista de IPs permitidos |
| 8.24 Uso de criptografia | Cofre cifrado no navegador: AES-256-GCM, RSA-OAEP 3072, PBKDF2-SHA256 com 600.000 iterações. Segredos do servidor em AES-256-GCM com chave fora do banco e rotação (`DATA_ENCRYPTION_KEY_OLD`) |
| 8.9, 8.19 Configuração segura | Containers sem privilégios extras (`no-new-privileges`, capacidades mínimas), cabeçalhos CSP, nosniff e Permissions-Policy |
| 8.8 Vulnerabilidades técnicas | `npm audit` sem pendências na publicação; rodar a cada atualização |
| 8.28, 8.29 Codificação e testes de segurança | Testes de ponta a ponta em `tests/e2e`, incluindo `security.mjs` e `fuzz.mjs` |

## Limitações conhecidas

- A senha de login chega ao servidor (protegida por TLS) para validação: um servidor comprometido poderia capturá-la.
- Título, usuário e URL das credenciais não são cifrados, pois alimentam a busca e o preenchimento automático.
- Administradores acessam pastas compartilhadas pela chave da organização; pastas pessoais ficam fora.
- A auditoria não detecta a remoção dos registros **mais recentes** por quem controla o banco. Envie os logs a um SIEM externo para cobrir esse caso.

## Responsabilidade da organização

Política de segurança, análise de riscos e Declaração de Aplicabilidade, classificação da informação, gestão de fornecedores, treinamento, resposta a incidentes, continuidade e testes de restauração, revisão periódica de acessos, segurança física, endurecimento do servidor (SSH só por chave, firewall, atualizações), guarda das chaves fora do servidor, teste de invasão independente e auditorias interna e externa.
