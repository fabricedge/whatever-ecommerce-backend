import { Hono } from "hono"
import { getPrisma } from "../lib/prisma.js"
import { authMiddleware, adminMiddleware, getUser } from "../lib/auth-middleware.js"

const pages = new Hono()

function getStoreId(c: any): string {
  return c.get("storeId")!
}

type Locale = 'pt' | 'en' | 'es'

interface PageData {
  slug: string
  pt: { title: string; content: string }
  en: { title: string; content: string }
  es: { title: string; content: string }
}

const DEFAULT_PAGE_DATA: PageData[] = [
  {
    slug: "privacy",
    pt: {
      title: "Política de Privacidade",
      content: `<p>Esta Política de Privacidade descreve como a <strong>{{store_name}}</strong> coleta, utiliza, armazena e protege os dados pessoais dos usuários em conformidade com a <strong>Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)</strong> e demais normas aplicáveis.</p><h2>1. Dados Coletados</h2><p>Podemos coletar as seguintes informações pessoais:</p><ul><li>Nome completo</li><li>Endereço de e-mail</li><li>Endereço de entrega (CEP, logradouro, número, complemento, bairro, cidade, estado)</li><li>Número de telefone</li><li>Dados de navegação (cookies, endereço IP, tipo de navegador, páginas acessadas)</li><li>Informações de pagamento processadas exclusivamente pelo Stripe (não armazenamos dados de cartão)</li></ul><h2>2. Finalidade do Tratamento</h2><p>Utilizamos seus dados para:</p><ul><li>Processar e entregar seus pedidos</li><li>Enviar comunicações relacionadas às suas compras (confirmação, status de entrega)</li><li>Atender solicitações de suporte ao cliente</li><li>Melhorar nossa plataforma e experiência do usuário</li><li>Cumprir obrigações legais e regulatórias</li><li>Prevenir fraudes e garantir a segurança das transações</li></ul><h2>3. Compartilhamento de Dados</h2><p>Compartilhamos seus dados apenas com:</p><ul><li><strong>Stripe</strong> — processamento de pagamentos (conforme política de privacidade do Stripe)</li><li><strong>Easyship</strong> — cálculo de frete e geração de etiquetas (quando aplicável)</li><li><strong>Vercel</strong> — hospedagem da plataforma</li><li><strong>Autoridades competentes</strong> — quando exigido por lei ou ordem judicial</li></ul><p>Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros para fins de marketing sem seu consentimento explícito.</p><h2>4. Direitos do Titular (LGPD)</h2><p>Nos termos da LGPD, você possui os seguintes direitos:</p><ul><li><strong>Confirmação e acesso:</strong> saber se tratamos seus dados e acessá-los</li><li><strong>Correção:</strong> solicitar a correção de dados incompletos, inexatos ou desatualizados</li><li><strong>Anonimização, bloqueio ou eliminação:</strong> solicitar a anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos</li><li><strong>Portabilidade:</strong> solicitar a portabilidade dos dados a outro fornecedor de serviço</li><li><strong>Eliminação:</strong> solicitar a eliminação dos dados tratados com consentimento</li><li><strong>Informação:</strong> ser informado sobre as entidades públicas ou privadas com as quais compartilhamos seus dados</li><li><strong>Revogação do consentimento:</strong> revogar o consentimento a qualquer tempo</li></ul><h2>5. Como Exercer seus Direitos</h2><p>Para exercer qualquer um dos direitos acima, entre em contato pelo e-mail <a href="mailto:privacidade@{{store_email_domain}}">privacidade@{{store_email_domain}}</a>. Responderemos em até <strong>15 dias úteis</strong>.</p><h2>6. Segurança</h2><p>Adotamos medidas técnicas e organizacionais para proteger seus dados pessoais contra acesso não autorizado, destruição, perda, alteração ou comunicação indevida.</p><h2>7. Alterações a esta Política</h2><p>Esta Política de Privacidade pode ser atualizada periodicamente. Recomendamos a revisão regular desta página. O uso continuado da plataforma após alterações constitui aceitação dos novos termos.</p><p><em>Última atualização: Junho de 2026</em></p>`,
    },
    en: {
      title: "Privacy Policy",
      content: `<p>This Privacy Policy describes how <strong>{{store_name}}</strong> collects, uses, stores, and protects users' personal data in compliance with applicable data protection laws.</p><h2>1. Data We Collect</h2><p>We may collect the following personal information:</p><ul><li>Full name</li><li>Email address</li><li>Delivery address (ZIP code, street, number, complement, neighborhood, city, state)</li><li>Phone number</li><li>Browsing data (cookies, IP address, browser type, pages visited)</li><li>Payment information processed exclusively by Stripe (we do not store card data)</li></ul><h2>2. Purpose of Processing</h2><p>We use your data to:</p><ul><li>Process and deliver your orders</li><li>Send communications related to your purchases (confirmation, delivery status)</li><li>Provide customer support</li><li>Improve our platform and user experience</li><li>Comply with legal and regulatory obligations</li><li>Prevent fraud and ensure transaction security</li></ul><h2>3. Data Sharing</h2><p>We share your data only with:</p><ul><li><strong>Stripe</strong> — payment processing</li><li><strong>Easyship</strong> — shipping rate calculation and label generation (when applicable)</li><li><strong>Vercel</strong> — platform hosting</li><li><strong>Competent authorities</strong> — when required by law or court order</li></ul><p>We do not sell, rent, or share your personal data with third parties for marketing purposes without your explicit consent.</p><h2>4. Your Rights</h2><p>Under applicable law, you have the following rights:</p><ul><li><strong>Confirmation and access:</strong> know whether we process your data and access it</li><li><strong>Correction:</strong> request correction of incomplete, inaccurate, or outdated data</li><li><strong>Deletion:</strong> request deletion of data processed with consent</li><li><strong>Portability:</strong> request data portability to another service provider</li><li><strong>Withdrawal of consent:</strong> withdraw consent at any time</li></ul><h2>5. Contact</h2><p>To exercise your rights, contact us at <a href="mailto:privacy@{{store_email_domain}}">privacy@{{store_email_domain}}</a>. We will respond within <strong>15 business days</strong>.</p><h2>6. Security</h2><p>We adopt technical and organizational measures to protect your personal data against unauthorized access, destruction, loss, alteration, or improper disclosure.</p><h2>7. Changes to this Policy</h2><p>This Privacy Policy may be updated periodically. We recommend regular review of this page. Continued use of the platform after changes constitutes acceptance of the new terms.</p><p><em>Last updated: June 2026</em></p>`,
    },
    es: {
      title: "Política de Privacidad",
      content: `<p>Esta Política de Privacidad describe cómo <strong>{{store_name}}</strong> recopila, utiliza, almacena y protege los datos personales de los usuarios en cumplimiento con las leyes de protección de datos aplicables.</p><h2>1. Datos Recopilados</h2><p>Podemos recopilar la siguiente información personal:</p><ul><li>Nombre completo</li><li>Dirección de correo electrónico</li><li>Dirección de entrega (código postal, calle, número, complemento, barrio, ciudad, estado)</li><li>Número de teléfono</li><li>Datos de navegación (cookies, dirección IP, tipo de navegador, páginas visitadas)</li><li>Información de pago procesada exclusivamente por Stripe (no almacenamos datos de tarjeta)</li></ul><h2>2. Finalidad del Tratamiento</h2><p>Utilizamos sus datos para:</p><ul><li>Procesar y entregar sus pedidos</li><li>Enviar comunicaciones relacionadas con sus compras (confirmación, estado de entrega)</li><li>Atender solicitudes de soporte al cliente</li><li>Mejorar nuestra plataforma y experiencia del usuario</li><li>Cumplir con obligaciones legales y regulatorias</li><li>Prevenir fraudes y garantizar la seguridad de las transacciones</li></ul><h2>3. Compartición de Datos</h2><p>Compartimos sus datos solo con:</p><ul><li><strong>Stripe</strong> — procesamiento de pagos</li><li><strong>Easyship</strong> — cálculo de tarifas de envío y generación de etiquetas (cuando corresponda)</li><li><strong>Vercel</strong> — alojamiento de la plataforma</li><li><strong>Autoridades competentes</strong> — cuando lo exija la ley o una orden judicial</li></ul><p>No vendemos, alquilamos ni compartimos sus datos personales con terceros con fines de marketing sin su consentimiento explícito.</p><h2>4. Sus Derechos</h2><p>Según la ley aplicable, usted tiene los siguientes derechos:</p><ul><li><strong>Confirmación y acceso:</strong> saber si procesamos sus datos y acceder a ellos</li><li><strong>Corrección:</strong> solicitar la corrección de datos incompletos, inexactos o desactualizados</li><li><strong>Eliminación:</strong> solicitar la eliminación de datos procesados con consentimiento</li><li><strong>Portabilidad:</strong> solicitar la portabilidad de datos a otro proveedor de servicios</li><li><strong>Retirada del consentimiento:</strong> retirar el consentimiento en cualquier momento</li></ul><h2>5. Contacto</h2><p>Para ejercer sus derechos, contáctenos en <a href="mailto:privacidad@{{store_email_domain}}">privacidad@{{store_email_domain}}</a>. Responderemos dentro de <strong>15 días hábiles</strong>.</p><h2>6. Seguridad</h2><p>Adoptamos medidas técnicas y organizativas para proteger sus datos personales contra acceso no autorizado, destrucción, pérdida, alteración o divulgación indebida.</p><h2>7. Cambios a esta Política</h2><p>Esta Política de Privacidad puede actualizarse periódicamente. Recomendamos la revisión regular de esta página. El uso continuado de la plataforma después de los cambios constituye aceptación de los nuevos términos.</p><p><em>Última actualización: Junio de 2026</em></p>`,
    },
  },
  {
    slug: "terms",
    pt: {
      title: "Termos de Serviço",
      content: `<p>Estes Termos de Serviço regulam o uso da plataforma <strong>{{store_name}}</strong>, incluindo a navegação no site e a compra de produtos. Ao utilizar nossos serviços, você concorda com os termos aqui descritos.</p><h2>1. Aceitação dos Termos</h2><p>Ao acessar ou utilizar a plataforma, você declara ter lido, compreendido e aceitado estes Termos de Serviço. Caso não concorde com qualquer condição, solicitamos que não utilize nossos serviços.</p><h2>2. Cadastro e Conta</h2><p>Para realizar compras, você pode optar por realizar o pedido como convidado (informando apenas e-mail) ou criar uma conta com nome, e-mail e senha. Você é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta.</p><h2>3. Produtos e Preços</h2><p>Os preços e a disponibilidade dos produtos estão sujeitos a alterações sem aviso prévio. As imagens dos produtos são ilustrativas. Nos esforçamos para apresentar as informações com a máxima precisão, mas pequenas variações podem ocorrer.</p><h2>4. Pagamento</h2><p>Os pagamentos são processados exclusivamente pelo <strong>Stripe</strong>, um provedor de pagamentos seguro e certificado. Não armazenamos informações de cartão de crédito ou dados financeiros em nossos servidores.</p><h2>5. Entrega</h2><p>Os prazos e custos de entrega são informados durante o checkout. Consulte nossa <a href="/pages/shipping-policy">Política de Envio</a> para mais detalhes.</p><h2>6. Direito de Arrependimento</h2><p>Nos termos do <strong>Artigo 49 do Código de Defesa do Consumidor (Lei nº 8.078/1990)</strong>, o consumidor pode desistir da compra no prazo de <strong>7 dias corridos</strong> a contar da data de recebimento do produto. Consulte nossa <a href="/pages/returns">Política de Trocas e Devoluções</a> para instruções detalhadas.</p><h2>7. Propriedade Intelectual</h2><p>Todo o conteúdo da plataforma, incluindo textos, imagens, logotipos e código-fonte, é de propriedade da {{store_name}} ou de seus licenciadores. É proibida a reprodução, distribuição ou modificação sem autorização prévia por escrito.</p><h2>8. Limitação de Responsabilidade</h2><p>A {{store_name}} não será responsável por danos indiretos, incidentais ou consequenciais decorrentes do uso ou da impossibilidade de uso da plataforma, exceto nos casos previstos em lei.</p><h2>9. Lei Aplicável</h2><p>Estes Termos são regidos pelas leis brasileiras. Qualquer disputa será resolvida no foro da comarca de São Paulo, SP.</p><p><em>Última atualização: Junho de 2026</em></p>`,
    },
    en: {
      title: "Terms of Service",
      content: `<p>These Terms of Service govern the use of the <strong>{{store_name}}</strong> platform, including browsing the site and purchasing products. By using our services, you agree to the terms described herein.</p><h2>1. Acceptance of Terms</h2><p>By accessing or using the platform, you declare that you have read, understood, and accepted these Terms of Service. If you do not agree with any condition, please do not use our services.</p><h2>2. Registration and Account</h2><p>To make purchases, you may order as a guest (providing only email) or create an account with name, email, and password. You are responsible for maintaining the confidentiality of your access credentials and for all activities carried out in your account.</p><h2>3. Products and Pricing</h2><p>Prices and product availability are subject to change without prior notice. Product images are for illustration purposes only.</p><h2>4. Payment</h2><p>Payments are processed exclusively by <strong>Stripe</strong>, a secure and certified payment provider. We do not store credit card information or financial data on our servers.</p><h2>5. Delivery</h2><p>Delivery times and costs are informed during checkout. See our <a href="/pages/shipping-policy">Shipping Policy</a> for details.</p><h2>6. Right of Withdrawal</h2><p>You may cancel your purchase within <strong>7 calendar days</strong> from the date of receipt. See our <a href="/pages/returns">Returns Policy</a> for detailed instructions.</p><h2>7. Intellectual Property</h2><p>All platform content, including text, images, logos, and source code, is owned by {{store_name}} or its licensors. Reproduction, distribution, or modification without prior written authorization is prohibited.</p><h2>8. Limitation of Liability</h2><p>{{store_name}} shall not be liable for indirect, incidental, or consequential damages arising from the use or inability to use the platform, except as provided by law.</p><h2>9. Governing Law</h2><p>These Terms are governed by Brazilian law. Any dispute shall be resolved in the courts of São Paulo, SP, Brazil.</p><p><em>Last updated: June 2026</em></p>`,
    },
    es: {
      title: "Términos de Servicio",
      content: `<p>Estos Términos de Servicio regulan el uso de la plataforma <strong>{{store_name}}</strong>, incluida la navegación del sitio y la compra de productos. Al utilizar nuestros servicios, usted acepta los términos aquí descritos.</p><h2>1. Aceptación de los Términos</h2><p>Al acceder o utilizar la plataforma, usted declara haber leído, comprendido y aceptado estos Términos de Servicio. Si no está de acuerdo con alguna condición, le solicitamos que no utilice nuestros servicios.</p><h2>2. Registro y Cuenta</h2><p>Para realizar compras, puede optar por pedir como invitado (proporcionando solo correo electrónico) o crear una cuenta con nombre, correo electrónico y contraseña. Usted es responsable de mantener la confidencialidad de sus credenciales de acceso y de todas las actividades realizadas en su cuenta.</p><h2>3. Productos y Precios</h2><p>Los precios y la disponibilidad de los productos están sujetos a cambios sin previo aviso. Las imágenes de los productos son ilustrativas.</p><h2>4. Pago</h2><p>Los pagos son procesados exclusivamente por <strong>Stripe</strong>, un proveedor de pagos seguro y certificado. No almacenamos información de tarjetas de crédito ni datos financieros en nuestros servidores.</p><h2>5. Entrega</h2><p>Los plazos y costos de entrega se informan durante el checkout. Consulte nuestra <a href="/pages/shipping-policy">Política de Envío</a> para más detalles.</p><h2>6. Derecho de Desistimiento</h2><p>Puede cancelar su compra dentro de los <strong>7 días calendario</strong> a partir de la fecha de recepción. Consulte nuestra <a href="/pages/returns">Política de Devoluciones</a> para instrucciones detalladas.</p><h2>7. Propiedad Intelectual</h2><p>Todo el contenido de la plataforma, incluidos textos, imágenes, logotipos y código fuente, es propiedad de {{store_name}} o sus licenciantes. Se prohíbe la reproducción, distribución o modificación sin autorización previa por escrito.</p><h2>8. Limitación de Responsabilidad</h2><p>{{store_name}} no será responsable por daños indirectos, incidentales o consecuentes derivados del uso o la imposibilidad de uso de la plataforma, excepto según lo dispuesto por la ley.</p><h2>9. Ley Aplicable</h2><p>Estos Términos se rigen por las leyes brasileñas. Cualquier disputa será resuelta en los tribunales de São Paulo, SP, Brasil.</p><p><em>Última actualización: Junio de 2026</em></p>`,
    },
  },
  {
    slug: "returns",
    pt: {
      title: "Política de Trocas e Devoluções",
      content: `<p>Esta política estabelece os procedimentos para troca, devolução e reembolso em conformidade com o <strong>Código de Defesa do Consumidor (Lei nº 8.078/1990)</strong>.</p><h2>1. Direito de Arrependimento</h2><p>Nos termos do Art. 49 do CDC, o consumidor pode desistir da compra no prazo de <strong>7 dias corridos</strong> a contar da data de recebimento do produto, sem necessidade de justificativa. O produto deve estar em perfeito estado, na embalagem original, com todos os acessórios e manuais.</p><h2>2. Produtos com Defeito</h2><p>Caso o produto apresente defeito de fabricação, o consumidor tem direito à troca ou reembolso, nos termos do Art. 18 do CDC. O prazo para reclamar é de <strong>30 dias</strong> para produtos não duráveis e <strong>90 dias</strong> para produtos duráveis.</p><h2>3. Como Solicitar</h2><p>Envie um e-mail para <a href="mailto:trocas@{{store_email_domain}}">trocas@{{store_email_domain}}</a> com o número do pedido e descrição do problema. Nossa equipe analisará a solicitação em até <strong>2 dias úteis</strong>. Se aprovada, enviaremos as instruções para devolução.</p><h2>4. Prazos de Reembolso</h2><p><strong>Cartão de crédito:</strong> estorno solicitado em até 10 dias úteis após o recebimento do produto devolvido. <strong>PIX:</strong> reembolso em até 5 dias úteis. <strong>Boleto bancário:</strong> reembolso em até 10 dias úteis.</p><h2>5. Custos de Devolução</h2><p>No caso de desistência (direito de arrependimento) ou produto com defeito, os custos de envio da devolução são de responsabilidade da <strong>{{store_name}}</strong>. Enviaremos um código de postagem pré-pago.</p><h2>6. Contato</h2><p>Para dúvidas: <a href="mailto:trocas@{{store_email_domain}}">trocas@{{store_email_domain}}</a>.</p>`,
    },
    en: {
      title: "Returns and Refunds Policy",
      content: `<p>This policy establishes the procedures for exchange, return, and refund.</p><h2>1. Right of Withdrawal</h2><p>You may cancel your purchase within <strong>7 calendar days</strong> from the date of receipt, without need for justification. The product must be in perfect condition, in its original packaging, with all accessories and manuals.</p><h2>2. Defective Products</h2><p>If the product has a manufacturing defect, you are entitled to exchange or refund. The claim period is <strong>30 days</strong> for non-durable products and <strong>90 days</strong> for durable products.</p><h2>3. How to Request</h2><p>Send an email to <a href="mailto:returns@{{store_email_domain}}">returns@{{store_email_domain}}</a> with your order number and a description of the issue. Our team will analyze your request within <strong>2 business days</strong>. If approved, we will send return instructions.</p><h2>4. Refund Timelines</h2><p><strong>Credit card:</strong> refund requested within 10 business days after receiving the returned product. <strong>Other methods:</strong> refund within 5-10 business days.</p><h2>5. Return Costs</h2><p>In case of withdrawal or defective product, return shipping costs are covered by <strong>{{store_name}}</strong>. We will provide a prepaid shipping label.</p><h2>6. Contact</h2><p>Questions: <a href="mailto:returns@{{store_email_domain}}">returns@{{store_email_domain}}</a>.</p>`,
    },
    es: {
      title: "Política de Devoluciones y Reembolsos",
      content: `<p>Esta política establece los procedimientos para cambio, devolución y reembolso.</p><h2>1. Derecho de Desistimiento</h2><p>Puede cancelar su compra dentro de los <strong>7 días calendario</strong> a partir de la fecha de recepción, sin necesidad de justificación. El producto debe estar en perfecto estado, en su embalaje original, con todos los accesorios y manuales.</p><h2>2. Productos Defectuosos</h2><p>Si el producto tiene un defecto de fabricación, tiene derecho a cambio o reembolso. El plazo de reclamación es de <strong>30 días</strong> para productos no duraderos y <strong>90 días</strong> para productos duraderos.</p><h2>3. Cómo Solicitar</h2><p>Envíe un correo electrónico a <a href="mailto:devoluciones@{{store_email_domain}}">devoluciones@{{store_email_domain}}</a> con el número de pedido y la descripción del problema. Nuestro equipo analizará su solicitud dentro de <strong>2 días hábiles</strong>. Si se aprueba, enviaremos instrucciones de devolución.</p><h2>4. Plazos de Reembolso</h2><p><strong>Tarjeta de crédito:</strong> reembolso solicitado dentro de los 10 días hábiles posteriores a la recepción del producto devuelto. <strong>Otros métodos:</strong> reembolso en 5-10 días hábiles.</p><h2>5. Costos de Devolución</h2><p>En caso de desistimiento o producto defectuoso, los costos de envío de la devolución son cubiertos por <strong>{{store_name}}</strong>. Proporcionaremos una etiqueta de envío prepagada.</p><h2>6. Contacto</h2><p>Preguntas: <a href="mailto:devoluciones@{{store_email_domain}}">devoluciones@{{store_email_domain}}</a>.</p>`,
    },
  },
  {
    slug: "shipping-policy",
    pt: {
      title: "Política de Envio",
      content: `<p>Esta Política de Envio descreve as condições de entrega dos produtos adquiridos na plataforma <strong>{{store_name}}</strong>.</p><h2>1. Áreas de Entrega</h2><p>Realizamos entregas em todo o <strong>território brasileiro</strong>. O cálculo do frete é realizado automaticamente durante o checkout com base no CEP de destino.</p><h2>2. Prazos de Postagem</h2><p>Após a confirmação do pagamento, os produtos são postados em até <strong>2 dias úteis</strong>.</p><h2>3. Prazos de Entrega</h2><p>Os prazos estimados de entrega são exibidos durante o checkout e dependem da transportadora e da localidade de destino.</p><h2>4. Custos de Frete</h2><p>O valor do frete é calculado automaticamente com base no CEP de destino, peso e dimensões do pacote.</p><h2>5. Acompanhamento</h2><p>Após a postagem, você receberá um e-mail com o código de rastreamento para acompanhar a entrega.</p><h2>6. Extravio ou Danos</h2><p>Caso o produto seja extraviado ou chegue danificado, entre em contato em até <strong>48 horas</strong> do recebimento pelo e-mail <a href="mailto:suporte@{{store_email_domain}}">suporte@{{store_email_domain}}</a>.</p><h2>7. Contato</h2><p>Para dúvidas: <a href="mailto:suporte@{{store_email_domain}}">suporte@{{store_email_domain}}</a>.</p>`,
    },
    en: {
      title: "Shipping Policy",
      content: `<p>This Shipping Policy describes the delivery conditions for products purchased on the <strong>{{store_name}}</strong> platform.</p><h2>1. Delivery Areas</h2><p>We deliver to all addresses. Shipping rates are calculated automatically during checkout based on the destination.</p><h2>2. Dispatch Times</h2><p>After payment confirmation, products are dispatched within <strong>2 business days</strong>.</p><h2>3. Delivery Times</h2><p>Estimated delivery times are displayed during checkout and depend on the carrier and destination.</p><h2>4. Shipping Costs</h2><p>Shipping costs are calculated automatically based on the destination, weight, and package dimensions.</p><h2>5. Tracking</h2><p>After dispatch, you will receive an email with a tracking code to follow your delivery.</p><h2>6. Loss or Damage</h2><p>If a product is lost or arrives damaged, contact us within <strong>48 hours</strong> of receipt at <a href="mailto:support@{{store_email_domain}}">support@{{store_email_domain}}</a>.</p><h2>7. Contact</h2><p>Questions: <a href="mailto:support@{{store_email_domain}}">support@{{store_email_domain}}</a>.</p>`,
    },
    es: {
      title: "Política de Envío",
      content: `<p>Esta Política de Envío describe las condiciones de entrega de los productos adquiridos en la plataforma <strong>{{store_name}}</strong>.</p><h2>1. Áreas de Entrega</h2><p>Realizamos entregas a todas las direcciones. Las tarifas de envío se calculan automáticamente durante el checkout según el destino.</p><h2>2. Plazos de Despacho</h2><p>Después de la confirmación del pago, los productos se despachan dentro de <strong>2 días hábiles</strong>.</p><h2>3. Plazos de Entrega</h2><p>Los plazos de entrega estimados se muestran durante el checkout y dependen del transportista y el destino.</p><h2>4. Costos de Envío</h2><p>Los costos de envío se calculan automáticamente según el destino, el peso y las dimensiones del paquete.</p><h2>5. Seguimiento</h2><p>Después del despacho, recibirá un correo electrónico con un código de seguimiento.</p><h2>6. Pérdida o Daños</h2><p>Si un producto se pierde o llega dañado, contáctenos dentro de las <strong>48 horas</strong> posteriores a la recepción en <a href="mailto:soporte@{{store_email_domain}}">soporte@{{store_email_domain}}</a>.</p><h2>7. Contacto</h2><p>Preguntas: <a href="mailto:soporte@{{store_email_domain}}">soporte@{{store_email_domain}}</a>.</p>`,
    },
  },
  {
    slug: "cookies",
    pt: {
      title: "Política de Cookies",
      content: `<p>Esta Política de Cookies explica o que são cookies, como os utilizamos e como você pode gerenciar suas preferências, em conformidade com a <strong>Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>.</p><h2>1. O que são Cookies?</h2><p>Cookies são pequenos arquivos de texto armazenados no seu navegador quando você visita um site. Eles permitem que o site reconheça seu dispositivo e lembre de suas preferências.</p><h2>2. Tipos de Cookies que Utilizamos</h2><h3>Cookies Essenciais</h3><p>Necessários para o funcionamento básico do site: gerenciamento de sessão do carrinho, autenticação do usuário, prevenção de fraudes.</p><h3>Cookies de Preferência</h3><p>Permitem que o site lembre suas escolhas (como idioma e moeda) para oferecer uma experiência personalizada.</p><h3>Cookies de Analytics</h3><p>Coletam informações anônimas sobre como os visitantes utilizam o site: páginas mais visitadas, tempo de permanência, origem do tráfego.</p><h2>3. Cookies de Terceiros</h2><p>Utilizamos serviços de terceiros que podem definir cookies em seu navegador: <strong>Stripe</strong> (processamento de pagamentos) e <strong>Vercel</strong> (hospedagem e analytics).</p><h2>4. Gerenciamento de Cookies</h2><p>Ao acessar nosso site pela primeira vez, exibimos um banner de consentimento. Você também pode gerenciar ou desabilitar cookies diretamente nas configurações do seu navegador. Observe que a desativação de cookies essenciais pode afetar o funcionamento do site.</p><h2>5. Contato</h2><p>Em caso de dúvidas: <a href="mailto:privacidade@{{store_email_domain}}">privacidade@{{store_email_domain}}</a>.</p>`,
    },
    en: {
      title: "Cookie Policy",
      content: `<p>This Cookie Policy explains what cookies are, how we use them, and how you can manage your preferences.</p><h2>1. What are Cookies?</h2><p>Cookies are small text files stored on your browser when you visit a website. They allow the site to recognize your device and remember your preferences.</p><h2>2. Types of Cookies We Use</h2><h3>Essential Cookies</h3><p>Necessary for basic site functionality: cart session management, user authentication, fraud prevention.</p><h3>Preference Cookies</h3><p>Allow the site to remember your choices (such as language and currency) to provide a personalized experience.</p><h3>Analytics Cookies</h3><p>Collect anonymous information about how visitors use the site: most visited pages, time spent, traffic sources.</p><h2>3. Third-Party Cookies</h2><p>We use third-party services that may set cookies in your browser: <strong>Stripe</strong> (payment processing) and <strong>Vercel</strong> (hosting and analytics).</p><h2>4. Managing Cookies</h2><p>When you first access our site, we display a consent banner. You can also manage or disable cookies directly in your browser settings. Disabling essential cookies may affect site functionality.</p><h2>5. Contact</h2><p>Questions: <a href="mailto:privacy@{{store_email_domain}}">privacy@{{store_email_domain}}</a>.</p>`,
    },
    es: {
      title: "Política de Cookies",
      content: `<p>Esta Política de Cookies explica qué son las cookies, cómo las utilizamos y cómo puede gestionar sus preferencias.</p><h2>1. ¿Qué son las Cookies?</h2><p>Las cookies son pequeños archivos de texto almacenados en su navegador cuando visita un sitio web. Permiten que el sitio reconozca su dispositivo y recuerde sus preferencias.</p><h2>2. Tipos de Cookies que Utilizamos</h2><h3>Cookies Esenciales</h3><p>Necesarias para el funcionamiento básico del sitio: gestión de sesión del carrito, autenticación del usuario, prevención de fraudes.</p><h3>Cookies de Preferencia</h3><p>Permiten que el sitio recuerde sus elecciones (como idioma y moneda) para ofrecer una experiencia personalizada.</p><h3>Cookies de Análisis</h3><p>Recopilan información anónima sobre cómo los visitantes utilizan el sitio: páginas más visitadas, tiempo de permanencia, fuentes de tráfico.</p><h2>3. Cookies de Terceros</h2><p>Utilizamos servicios de terceros que pueden establecer cookies en su navegador: <strong>Stripe</strong> (procesamiento de pagos) y <strong>Vercel</strong> (alojamiento y análisis).</p><h2>4. Gestión de Cookies</h2><p>Cuando accede a nuestro sitio por primera vez, mostramos un banner de consentimiento. También puede gestionar o deshabilitar las cookies directamente en la configuración de su navegador. La desactivación de cookies esenciales puede afectar el funcionamiento del sitio.</p><h2>5. Contacto</h2><p>Preguntas: <a href="mailto:privacidad@{{store_email_domain}}">privacidad@{{store_email_domain}}</a>.</p>`,
    },
  },
]

export function getDefaultPages(locale: Locale = 'pt'): { slug: string; title: string; content: string }[] {
  return DEFAULT_PAGE_DATA.map((page) => ({
    slug: page.slug,
    ...(page[locale] || page.pt),
  }))
}

async function applyPlaceholders(content: string, storeId: string): Promise<string> {
  const store = await getPrisma().store.findUnique({
    where: { id: storeId },
    select: { name: true },
  })
  if (!store) return content

  const emailSetting = await getPrisma().setting.findUnique({
    where: { storeId_key: { storeId, key: "store_email" } },
  })
  const emailDomain = emailSetting?.value || "loja.com"

  return content
    .replace(/\{\{store_name\}\}/g, store.name)
    .replace(/\{\{store_email_domain\}\}/g, emailDomain)
}

// Public: list active pages for a store
pages.get("/", async (c) => {
  const storeId = c.req.query("storeId") || c.req.header("X-Store-Id")
  if (!storeId) return c.json({ error: "storeId is required" }, 400)

  const all = await getPrisma().page.findMany({
    where: { storeId, isActive: true },
    select: { slug: true, title: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  })
  return c.json({ pages: all })
})

// Admin: list page templates (recommended defaults)
pages.get("/templates", authMiddleware, adminMiddleware, async (c) => {
  const locale = (c.req.query("locale") || "pt") as Locale
  const storeId = getStoreId(c)
  const templates = getDefaultPages(locale)
  const resolved = await Promise.all(templates.map(async (tpl) => ({
    ...tpl,
    content: await applyPlaceholders(tpl.content, storeId),
  })))
  return c.json({ templates: resolved })
})

// Admin: list all pages (including inactive)
pages.get("/admin", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const all = await getPrisma().page.findMany({
    where: { storeId },
    orderBy: { createdAt: "asc" },
  })
  return c.json({ pages: all })
})

// Public: get single active page by slug
pages.get("/:slug", async (c) => {
  const slug = c.req.param("slug")!
  const storeId = c.req.query("storeId") || c.req.header("X-Store-Id")
  if (!storeId) return c.json({ error: "storeId is required" }, 400)

  const page = await getPrisma().page.findUnique({
    where: { storeId_slug: { storeId, slug } },
  })
  if (!page || !page.isActive) return c.json({ error: "Page not found" }, 404)
  const content = await applyPlaceholders(page.content, storeId)
  return c.json({ slug: page.slug, title: page.title, content, updatedAt: page.updatedAt })
})

// Admin: get single page by slug (any status)
pages.get("/admin/:slug", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const slug = c.req.param("slug")!
  const page = await getPrisma().page.findUnique({
    where: { storeId_slug: { storeId, slug } },
  })
  if (!page) return c.json({ error: "Page not found" }, 404)
  return c.json({ ...page, content: await applyPlaceholders(page.content, storeId) })
})

// Admin: create page
pages.post("/", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const body = await c.req.json()
  const slug: string = body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  if (!slug) return c.json({ error: "slug is required" }, 400)
  if (!body.title?.trim()) return c.json({ error: "title is required" }, 400)

  const existing = await getPrisma().page.findUnique({
    where: { storeId_slug: { storeId, slug } },
  })
  if (existing) return c.json({ error: "A page with this slug already exists" }, 409)

  const page = await getPrisma().page.create({
    data: {
      storeId,
      slug,
      title: body.title.trim(),
      content: body.content || "",
      isActive: body.isActive !== false,
    },
  })
  return c.json(page, 201)
})

// Admin: update page
pages.put("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")!
  const body = await c.req.json()

  const page = await getPrisma().page.findUnique({ where: { id } })
  if (!page || page.storeId !== storeId) return c.json({ error: "Page not found" }, 404)

  const data: Record<string, any> = {}
  if (body.title !== undefined) data.title = body.title.trim()
  if (body.content !== undefined) data.content = body.content
  if (body.isActive !== undefined) data.isActive = body.isActive

  if (body.slug !== undefined && body.slug !== page.slug) {
    const newSlug = body.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "")
    if (!newSlug) return c.json({ error: "Invalid slug" }, 400)
    const existing = await getPrisma().page.findUnique({
      where: { storeId_slug: { storeId, slug: newSlug } },
    })
    if (existing) return c.json({ error: "A page with this slug already exists" }, 409)
    data.slug = newSlug
  }

  const updated = await getPrisma().page.update({
    where: { id },
    data,
  })
  return c.json(updated)
})

// Admin: toggle page active
pages.patch("/:id/toggle", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")!
  const page = await getPrisma().page.findUnique({ where: { id } })
  if (!page || page.storeId !== storeId) return c.json({ error: "Page not found" }, 404)

  const updated = await getPrisma().page.update({
    where: { id },
    data: { isActive: !page.isActive },
  })
  return c.json(updated)
})

// Admin: delete page
pages.delete("/:id", authMiddleware, adminMiddleware, async (c) => {
  const storeId = getStoreId(c)
  const id = c.req.param("id")!
  const page = await getPrisma().page.findUnique({ where: { id } })
  if (!page || page.storeId !== storeId) return c.json({ error: "Page not found" }, 404)

  await getPrisma().page.delete({ where: { id } })
  return c.json({ success: true })
})

export default pages
