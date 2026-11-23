import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { useSettingsStore } from '../stores/settingsStore.js';

const NOT_SET = 'a ser informado pela organização';

function Section({ n, title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{n}. {title}</h2>
      <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--color-text-muted)' }}>{children}</div>
    </section>
  );
}

// Política de Privacidade (Lei 13.709/2018 — LGPD). Pública, inclusive antes do login.
// Os dados do controlador vêm de Configurações › Geral.
export default function PrivacyPage() {
  const settings = useSettingsStore(s => s.settings);
  const p = settings.privacyConfig || {};
  const site = settings.siteName || 'VaultGuard';
  const auditDays = settings.privacyRetention?.auditDays;
  const trashDays = settings.privacyRetention?.trashDays;
  const th = 'text-left p-2 font-semibold';
  const td = 'p-2 align-top';
  const row = { borderBottom: '1px solid var(--color-border)' };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--color-bg)' }}>
      <main className="max-w-3xl mx-auto px-5 py-10 space-y-7">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-primary)' }}>
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <header>
          <h1 className="text-3xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <ShieldCheck className="w-7 h-7" style={{ color: 'var(--color-primary)' }} /> Política de Privacidade
          </h1>
          <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
            {site} · em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018){p.policyUpdatedAt ? ` · atualizada em ${new Date(`${p.policyUpdatedAt}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
          </p>
        </header>

        <Section n="1" title="Quem trata os seus dados">
          <p>O controlador dos dados é <b>{p.controllerName || NOT_SET}</b>{p.cnpj ? `, CNPJ ${p.cnpj}` : ''}{p.address ? `, com sede em ${p.address}` : ''}, organização que disponibiliza o {site} às pessoas autorizadas.</p>
          <p>Encarregado pelo tratamento de dados pessoais (DPO): <b>{p.dpoName || NOT_SET}</b>{p.dpoEmail ? <> — <a href={`mailto:${p.dpoEmail}`} style={{ color: 'var(--color-primary)' }}>{p.dpoEmail}</a></> : ''}.</p>
        </Section>

        <Section n="2" title="Quais dados tratamos, para quê e com qual base legal">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead><tr style={row}><th className={th}>Dados</th><th className={th}>Finalidade</th><th className={th}>Base legal (art. 7º)</th></tr></thead>
              <tbody>
                <tr style={row}><td className={td}>Nome, e-mail, usuário, cargo, grupos e foto</td><td className={td}>Criar a conta e controlar o acesso</td><td className={td}>Execução de contrato (V) e legítimo interesse (IX)</td></tr>
                <tr style={row}><td className={td}>Senha de acesso (somente em hash) e segundo fator</td><td className={td}>Autenticar a pessoa com segurança</td><td className={td}>Legítimo interesse (IX)</td></tr>
                <tr style={row}><td className={td}>IP, navegador, identificador de dispositivo, data e hora das ações</td><td className={td}>Segurança, prevenção a fraudes e trilha de auditoria</td><td className={td}>Obrigação legal (II), exercício de direitos (VI) e legítimo interesse (IX)</td></tr>
                <tr style={row}><td className={td}>Senhas, anotações, campos secretos e anexos guardados no cofre</td><td className={td}>Guardar e compartilhar credenciais de trabalho</td><td className={td}>Execução de contrato (V) e legítimo interesse (IX)</td></tr>
                <tr style={row}><td className={td}>Dados do Active Directory, quando integrado</td><td className={td}>Login corporativo e sincronização de contas</td><td className={td}>Execução de contrato (V) e legítimo interesse (IX)</td></tr>
              </tbody>
            </table>
          </div>
          <p>Não usamos seus dados para publicidade, não os vendemos e não tomamos decisões automatizadas que afetem seus interesses. O sistema é destinado a uso profissional por maiores de idade.</p>
        </Section>

        <Section n="3" title="Com quem compartilhamos">
          <p>Os dados ficam na infraestrutura indicada pelo controlador. O acesso é limitado às pessoas autorizadas pelos cargos, grupos e permissões. Podem receber dados: administradores do sistema, fornecedores de infraestrutura e de e-mail contratados pelo controlador, e autoridades públicas quando houver obrigação legal.</p>
          <p>Se o envio de e-mails usar um serviço em nuvem com servidores fora do Brasil, a transferência internacional seguirá os arts. 33 a 36 da LGPD.</p>
        </Section>

        <Section n="4" title="Por quanto tempo guardamos">
          <ul className="list-disc pl-5 space-y-1">
            <li>Dados da conta: enquanto houver vínculo e pelo prazo necessário a obrigações legais.</li>
            <li>Registros de auditoria: {auditDays ? `${auditDays} dias, em janela móvel (os mais antigos são sobrescritos)` : 'pelo prazo definido pelo controlador'}.</li>
            <li>Itens excluídos: ficam na Lixeira por {trashDays ? `${trashDays} dias` : 'prazo definido pelo controlador'} e depois são eliminados.</li>
            <li>Cópias de segurança: pelo prazo de retenção definido pelo controlador, cifradas.</li>
          </ul>
        </Section>

        <Section n="5" title="Como protegemos">
          <p>Senhas e conteúdos do cofre são cifrados no seu navegador (AES-256-GCM) antes de chegar ao servidor. A conexão usa HTTPS, a senha de acesso é guardada apenas em hash (bcrypt), há autenticação em dois fatores, controle de acesso por perfil, registros à prova de adulteração e cópias de segurança cifradas.</p>
        </Section>

        <Section n="6" title="Cookies e armazenamento no navegador">
          <p>Usamos apenas um cookie estritamente necessário (<code>vg_session</code>), que mantém sua sessão e não é acessível a scripts. O navegador também guarda preferências como idioma e tema. Não usamos cookies de publicidade nem de rastreamento, e nenhuma fonte ou script é carregado de terceiros.</p>
        </Section>

        <Section n="7" title="Seus direitos (art. 18)">
          <p>Você pode solicitar: confirmação do tratamento; acesso aos dados; correção; anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos; portabilidade; informação sobre compartilhamentos; informação sobre a possibilidade de não consentir; e revisão do tratamento. Quando o tratamento se basear em consentimento, você pode revogá-lo.</p>
          <p>Em <b>Perfil</b> você baixa uma cópia dos seus dados. Os demais pedidos são feitos ao encarregado{p.dpoEmail ? <> pelo e-mail <a href={`mailto:${p.dpoEmail}`} style={{ color: 'var(--color-primary)' }}>{p.dpoEmail}</a></> : ''}. A declaração completa é fornecida em até 15 dias (art. 19, II). Alguns dados podem ser mantidos para cumprir obrigação legal ou para o exercício regular de direitos (art. 16).</p>
          <p>Você também pode peticionar à Autoridade Nacional de Proteção de Dados (ANPD): <a href="https://www.gov.br/anpd" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)' }}>www.gov.br/anpd</a>.</p>
        </Section>

        <Section n="8" title="Incidentes de segurança">
          <p>Se ocorrer um incidente que possa causar risco ou dano relevante, o controlador comunicará a ANPD e as pessoas afetadas nos termos do art. 48 da LGPD e da regulamentação da ANPD.</p>
        </Section>

        <Section n="9" title="Alterações">
          <p>Esta política pode ser atualizada. A data da última alteração aparece no início desta página.</p>
        </Section>
      </main>
    </div>
  );
}
