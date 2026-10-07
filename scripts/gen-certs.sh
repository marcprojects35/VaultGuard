#!/bin/bash
# Gera o certificado HTTPS do VaultGuard assinado por uma autoridade
# certificadora (CA) própria da instalação.
#
#   bash scripts/gen-certs.sh 192.168.0.78 [vault.empresa.local ...]
#
# Por que uma CA própria e não um certificado autoassinado: o cofre e a
# extensão só funcionam em HTTPS, e o Chrome recusa certificados em que não
# confia. Basta instalar UMA vez o certificado público da CA (ssl/ca.crt) como
# confiável em cada computador — depois disso não há aviso, e renovar o
# certificado do servidor não exige reinstalar nada nos computadores.
#
# Arquivos:
#   ssl/cert.pem, ssl/key.pem  certificado e chave do servidor (usados pelo nginx)
#   ssl/ca.crt                 certificado público da CA (distribuir aos computadores;
#                              também servido em https://<servidor>/ca.crt)
#   ssl-ca/ca.key              chave privada da CA — fica só no servidor, fora da
#                              pasta montada no nginx. Guarde backup em local seguro.
#
# Rodar de novo renova o certificado do servidor e reaproveita a CA existente.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Uso: $0 <IP-ou-nome> [outros nomes/IPs...]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
ORG="${COMPANY_NAME:-VaultGuard}"
umask 077
mkdir -p ssl ssl-ca

# Nomes aceitos pelo certificado (SAN): IPs como IP:, o resto como DNS:
SAN=""
for name in "$@"; do
  if [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then SAN+="IP:$name,"; else SAN+="DNS:$name,"; fi
done
SAN="${SAN%,}"

if [ ! -f ssl-ca/ca.key ] || [ ! -f ssl-ca/ca.crt ]; then
  echo "Criando autoridade certificadora própria (10 anos)..."
  openssl genrsa -out ssl-ca/ca.key 4096 2>/dev/null
  openssl req -x509 -new -key ssl-ca/ca.key -sha256 -days 3650 -out ssl-ca/ca.crt \
    -subj "/CN=${ORG} VaultGuard CA/O=${ORG}" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>&1
fi

echo "Emitindo certificado do servidor para: $SAN"
cat > ssl-ca/server.ext <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${SAN}
EOF
openssl genrsa -out ssl/key.pem 2048 2>/dev/null
openssl req -new -key ssl/key.pem -subj "/CN=$1/O=${ORG}" -out ssl-ca/server.csr 2>/dev/null
# 825 dias: limite aceito pelos navegadores para certificados de servidor
openssl x509 -req -in ssl-ca/server.csr -CA ssl-ca/ca.crt -CAkey ssl-ca/ca.key -CAcreateserial \
  -days 825 -sha256 -extfile ssl-ca/server.ext -out ssl-ca/server.crt 2>/dev/null
openssl verify -CAfile ssl-ca/ca.crt ssl-ca/server.crt >/dev/null

cat ssl-ca/server.crt ssl-ca/ca.crt > ssl/cert.pem
cp ssl-ca/ca.crt ssl/ca.crt
chmod 600 ssl/key.pem ssl-ca/ca.key
chmod 644 ssl/cert.pem ssl/ca.crt
chmod 700 ssl-ca
chmod 755 ssl

echo
echo "Pronto. Validade do certificado do servidor: $(openssl x509 -in ssl-ca/server.crt -noout -enddate | cut -d= -f2)"
echo "Instale ssl/ca.crt como autoridade confiável em cada computador (uma vez):"
echo "  Windows: duplo clique em ca.crt > Instalar > Máquina local > 'Autoridades de Certificação Raiz Confiáveis' (ou via GPO)"
echo "  macOS:   Acesso às Chaves > Sistema > importar ca.crt > 'Sempre confiar'"
echo "  Linux:   certutil -d sql:\$HOME/.pki/nssdb -A -t 'C,,' -n 'VaultGuard CA' -i ca.crt  (Chrome)"
echo "Ele também fica disponível em https://$1:<porta>/ca.crt"
