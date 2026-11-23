# Documento de Conformidade com a LGPD

**Sistema:** VaultGuard (cofre de senhas corporativo)
**Norma:** Lei nº 13.709/2018 (LGPD) e regulamentos da ANPD
**Público:** encarregado de dados (DPO), jurídico, TI e auditoria

> Modelo técnico preenchido com o funcionamento real do sistema. Antes de adotar, a organização deve completar os campos entre colchetes e submeter o documento à revisão do jurídico. A política pública fica em `/privacidade` e usa os dados de **Configurações › Geral › Privacidade (LGPD)**.

## 1. Papéis

| Papel | Quem |
|---|---|
| Controlador (art. 5º, VI) | [Razão social e CNPJ da organização que usa o sistema] |
| Operadores (art. 5º, VII) | [Hospedagem, e-mail e demais fornecedores contratados] |
| Encarregado (art. 41) | [Nome e canal de contato, publicados na política] |
| Titulares | Colaboradores e demais pessoas com conta no sistema; pessoas citadas em credenciais |

## 2. Registro das operações de tratamento (art. 37)

| Operação | Dados pessoais | Finalidade | Base legal (art. 7º) | Retenção | Onde fica |
|---|---|---|---|---|---|
| Cadastro e acesso | Nome, e-mail, usuário, cargo, grupos, foto | Identificar e autorizar | V e IX | Enquanto houver vínculo + obrigações legais | Banco de dados |
| Autenticação | Hash bcrypt da senha, segredo do 2FA (cifrado), histórico de hashes | Autenticar | IX | Enquanto a conta existir | Banco de dados |
| Segurança e auditoria | IP, navegador, dispositivo, ações, data e hora | Prevenir fraudes e comprovar ações | II, VI e IX | Configurável (padrão de 90 dias, em janela móvel) | Banco de dados |
| Cofre | Senhas, anotações, campos secretos e anexos cifrados no navegador; título, usuário e URL sem cifra | Guardar credenciais de trabalho | V e IX | Até exclusão + prazo da Lixeira (padrão de 30 dias) | Banco de dados |
| Integração com AD | Nome, e-mail, login, grupos | Login corporativo | V e IX | Enquanto a conta existir | Banco de dados |
| E-mails de aviso | E-mail, nome, evento | Alertas de segurança | IX | Conforme o provedor | [Provedor de e-mail] |
| Cópias de segurança | Todos os anteriores, cifrados com AES-256 | Continuidade | IX | 30 dias | Servidor [e cópia externa] |

Dados sensíveis (art. 5º, II) não são coletados pelo sistema. Se alguém guardar esse tipo de dado em anotações ou anexos, o conteúdo permanece cifrado e a responsabilidade pelo uso é da organização.

Para o legítimo interesse (inciso IX), a organização deve manter o teste de balanceamento documentado (art. 10).

## 3. Direitos dos titulares (art. 18)

| Direito | Como é atendido |
|---|---|
| Confirmação e acesso | Perfil › Segurança › **Baixar meus dados** |
| Correção | Perfil, ou administrador em Usuários |
| Portabilidade | Arquivo JSON do mesmo botão |
| Eliminação | Administrador exclui a conta; a pasta pessoal é apagada junto |
| Informação sobre compartilhamento | Política de Privacidade e encarregado |
| Oposição e revisão | Pedido ao encarregado |

Prazo: resposta simplificada imediata ou declaração completa em até 15 dias (art. 19). Registros necessários a obrigações legais podem ser mantidos (art. 16).

## 4. Medidas de segurança (art. 46)

Detalhadas em [SEGURANCA-ISO27001.md](SEGURANCA-ISO27001.md). Resumo: criptografia no navegador, TLS, bcrypt, 2FA, controle de acesso por perfil, RLS e privilégio mínimo no banco, auditoria à prova de adulteração, limite de requisições, proteção contra robôs e backups cifrados. O sistema não carrega fontes, scripts ou rastreadores de terceiros.

## 5. Plano de resposta a incidentes (art. 48)

1. **Detectar e registrar:** alertas, auditoria e botão *Verificar integridade*.
2. **Conter:** desativar contas, revogar tokens, trocar chaves e isolar o servidor.
3. **Avaliar:** dados, titulares afetados e risco ou dano relevante.
4. **Comunicar:** ANPD e titulares em até **3 dias úteis** do conhecimento do incidente que possa acarretar risco ou dano relevante (Resolução CD/ANPD nº 15/2024).
5. **Registrar:** manter o registro do incidente pelo prazo mínimo de 5 anos, mesmo sem comunicação.
6. **Corrigir** a causa e revisar os controles.

## 6. Relatório de Impacto (RIPD, art. 38)

O sistema concentra credenciais de acesso, por isso recomenda-se elaborar o RIPD.

| Risco | Medida existente | Risco residual |
|---|---|---|
| Vazamento do banco | Cofre cifrado no navegador; segredos com chave externa | Metadados (título, usuário, URL, e-mails) |
| Roubo de conta | 2FA, bloqueio, alertas de novo dispositivo | Phishing de quem não usa 2FA |
| Abuso por administrador | Auditoria imutável para a aplicação; pastas pessoais inacessíveis | Acesso às pastas compartilhadas |
| Servidor comprometido | Privilégio mínimo, containers restritos | Captura da senha no momento do login |
| Perda de dados | Backup diário cifrado | Depende da cópia externa e de testes de restauração |

## 7. O que a organização precisa fazer

- [ ] Preencher controlador e encarregado no sistema
- [ ] Publicar o canal do encarregado e definir o fluxo de atendimento
- [ ] Fazer o teste de legítimo interesse e o RIPD
- [ ] Firmar cláusulas de proteção de dados com operadores (art. 39)
- [ ] Avaliar transferência internacional, se o e-mail usar nuvem no exterior (arts. 33 a 36)
- [ ] Treinar as equipes e registrar o treinamento
- [ ] Testar o plano de incidentes e a restauração de backup
- [ ] Revisar este documento ao menos uma vez por ano
