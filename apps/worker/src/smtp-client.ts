import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import net, { type Socket } from "node:net";
import tls, { type TLSSocket } from "node:tls";

import {
  normalizeEmailAddress,
  normalizeEmailDisplayName
} from "@docomator/storage";

export interface SmtpClientOptions {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  rejectUnauthorized: boolean;
  user: string | null;
  password: string | null;
  timeoutMs: number;
}

export interface SmtpMailInput {
  fromAddress: string;
  fromName: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  text: string;
  messageId: string;
  attachmentName: string;
  attachment: Uint8Array;
}

export interface SmtpSendResult {
  response: string;
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

type SmtpSocket = Socket | TLSSocket;

export class SmtpClientError extends Error {
  override readonly name = "SmtpClientError";

  constructor(
    message: string,
    readonly retryable: boolean,
    readonly smtpCode: number | null = null
  ) {
    super(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function networkError(error: unknown): SmtpClientError {
  if (error instanceof SmtpClientError) return error;
  const message = errorMessage(error);
  const certificateFailure = /certificate|self[- ]signed|unable to verify/iu.test(
    message
  );
  return new SmtpClientError(
    `Ошибка соединения с SMTP-сервером: ${message}`,
    !certificateFailure
  );
}

function smtpFailure(response: SmtpResponse, operation: string): SmtpClientError {
  const retryable = response.code >= 400 && response.code < 500;
  return new SmtpClientError(
    `${operation}: SMTP ${response.code} ${response.lines.join(" ")}`,
    retryable,
    response.code
  );
}

function assertHeader(value: string, label: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\r\n\u0000]/u.test(normalized)
  ) {
    throw new SmtpClientError(`Недопустимое значение заголовка «${label}».`, false);
  }
  return normalized;
}

function encodedWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function mailbox(nameValue: string | null, addressValue: string): string {
  const address = normalizeEmailAddress(addressValue).address;
  const name = normalizeEmailDisplayName(nameValue);
  return name === null ? `<${address}>` : `${encodedWord(name)} <${address}>`;
}

function base64Lines(content: Uint8Array): string {
  const encoded = Buffer.from(content).toString("base64");
  const lines: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += 76) {
    lines.push(encoded.slice(offset, offset + 76));
  }
  return lines.join("\r\n");
}

function asciiFileName(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "")
    .slice(0, 100);
  return normalized.length === 0 ? "document.bin" : normalized;
}

function attachmentMediaType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function normalizeMessageId(value: string): string {
  const normalized = assertHeader(value, "Message-ID", 300);
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/u.test(normalized)) {
    throw new SmtpClientError("Недопустимый Message-ID.", false);
  }
  return normalized;
}

function buildMimeMessage(input: SmtpMailInput): string {
  const fromAddress = normalizeEmailAddress(input.fromAddress).address;
  const recipient = normalizeEmailAddress(input.recipientEmail).address;
  const fromName = assertHeader(input.fromName, "отправитель", 200);
  const subject = assertHeader(input.subject, "тема", 300);
  const attachmentName = assertHeader(input.attachmentName, "имя вложения", 240);
  const messageId = normalizeMessageId(input.messageId);
  const text = input.text.replace(/\r\n?/gu, "\n").trim();
  if (text.length === 0 || text.length > 20_000 || /\u0000/u.test(text)) {
    throw new SmtpClientError("Недопустимый текст письма.", false);
  }
  const boundary = `docomator-${randomUUID()}`;
  const encodedFileName = encodeURIComponent(attachmentName).replace(/'/gu, "%27");
  const fallbackName = asciiFileName(attachmentName);
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `From: ${mailbox(fromName, fromAddress)}`,
    `To: ${mailbox(input.recipientName, recipient)}`,
    `Subject: ${encodedWord(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "X-Mailer: Docomator"
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(text, "utf8")),
    `--${boundary}`,
    `Content-Type: ${attachmentMediaType(attachmentName)}; name="${fallbackName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedFileName}`,
    "",
    base64Lines(input.attachment),
    `--${boundary}--`,
    ""
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

function dotStuff(message: string): string {
  const normalized = message.replace(/\r?\n/gu, "\r\n");
  return normalized.replace(/(^|\r\n)\./gu, "$1..");
}

class SmtpResponseReader {
  private socket: SmtpSocket | null = null;
  private buffer = "";
  private responseCode: number | null = null;
  private responseLines: string[] = [];
  private readonly queued: SmtpResponse[] = [];
  private readonly waiters: Array<{
    resolve: (response: SmtpResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private failure: Error | null = null;

  constructor(private readonly timeoutMs: number) {}

  private readonly onData = (chunk: Buffer): void => {
    this.buffer += chunk.toString("utf8");
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const rawLine = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      const match = /^(\d{3})([- ])(.*)$/u.exec(rawLine);
      if (match === null) {
        this.fail(new Error(`Недопустимый ответ SMTP: ${rawLine}`));
        return;
      }
      const code = Number(match[1]);
      const separator = match[2];
      const message = match[3] ?? "";
      if (this.responseCode === null) this.responseCode = code;
      if (this.responseCode !== code) {
        this.fail(new Error("SMTP-сервер вернул несогласованный многострочный ответ."));
        return;
      }
      this.responseLines.push(message);
      if (separator === " ") {
        const response = {
          code,
          lines: this.responseLines
        };
        this.responseCode = null;
        this.responseLines = [];
        this.push(response);
      }
    }
  };

  private readonly onError = (error: Error): void => this.fail(error);
  private readonly onEnd = (): void =>
    this.fail(new Error("SMTP-сервер закрыл соединение."));
  private readonly onTimeout = (): void => {
    const error = new Error("Истекло время ожидания SMTP-сервера.");
    this.socket?.destroy(error);
    this.fail(error);
  };

  attach(socket: SmtpSocket): void {
    this.detach();
    this.socket = socket;
    socket.setTimeout(this.timeoutMs);
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("end", this.onEnd);
    socket.on("timeout", this.onTimeout);
  }

  detach(): void {
    if (this.socket === null) return;
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("end", this.onEnd);
    this.socket.off("timeout", this.onTimeout);
    this.socket.setTimeout(0);
    this.socket = null;
  }

  currentSocket(): SmtpSocket {
    if (this.socket === null) {
      throw new SmtpClientError("SMTP-соединение не установлено.", true);
    }
    return this.socket;
  }

  write(value: string | Buffer): void {
    this.currentSocket().write(value);
  }

  async read(): Promise<SmtpResponse> {
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    if (this.failure !== null) throw this.failure;
    return new Promise<SmtpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Истекло время ожидания ответа SMTP."));
      }, this.timeoutMs);
      timer.unref();
      this.waiters.push({ resolve, reject, timer });
    });
  }

  close(): void {
    const socket = this.socket;
    this.detach();
    socket?.destroy();
  }

  private push(response: SmtpResponse): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) {
      this.queued.push(response);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  }

  private fail(error: Error): void {
    if (this.failure !== null) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

async function connectSocket(
  options: SmtpClientOptions,
  reader: SmtpResponseReader
): Promise<SmtpSocket> {
  return new Promise<SmtpSocket>((resolve, reject) => {
    const socket = options.secure
      ? tls.connect({
          host: options.host,
          port: options.port,
          servername: options.host,
          rejectUnauthorized: options.rejectUnauthorized
        })
      : net.connect({ host: options.host, port: options.port });
    const event = options.secure ? "secureConnect" : "connect";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpClientError("Истекло время подключения к SMTP-серверу.", true));
    }, options.timeoutMs);
    timer.unref();
    socket.once(event, () => {
      clearTimeout(timer);
      reader.attach(socket);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(networkError(error));
    });
  });
}

async function upgradeToTls(
  socket: SmtpSocket,
  options: SmtpClientOptions,
  reader: SmtpResponseReader
): Promise<TLSSocket> {
  reader.detach();
  return new Promise<TLSSocket>((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: options.host,
      rejectUnauthorized: options.rejectUnauthorized
    });
    const timer = setTimeout(() => {
      secureSocket.destroy();
      reject(new SmtpClientError("Истекло время установки TLS для SMTP.", true));
    }, options.timeoutMs);
    timer.unref();
    secureSocket.once("secureConnect", () => {
      clearTimeout(timer);
      reader.attach(secureSocket);
      resolve(secureSocket);
    });
    secureSocket.once("error", (error) => {
      clearTimeout(timer);
      reject(networkError(error));
    });
  });
}

async function command(
  reader: SmtpResponseReader,
  value: string,
  expectedCodes: readonly number[],
  operation: string
): Promise<SmtpResponse> {
  reader.write(`${value}\r\n`);
  const response = await reader.read();
  if (!expectedCodes.includes(response.code)) {
    throw smtpFailure(response, operation);
  }
  return response;
}

function capabilities(response: SmtpResponse): string[] {
  return response.lines.map((line) => line.trim().toUpperCase());
}

function hasCapability(values: readonly string[], name: string): boolean {
  const upper = name.toUpperCase();
  return values.some((value) => value === upper || value.startsWith(`${upper} `));
}

function authenticationMethods(values: readonly string[]): Set<string> {
  const methods = new Set<string>();
  for (const value of values) {
    if (!value.startsWith("AUTH ")) continue;
    for (const method of value.slice(5).split(/\s+/u)) {
      if (method.length > 0) methods.add(method);
    }
  }
  return methods;
}

async function authenticate(
  reader: SmtpResponseReader,
  capabilitiesValue: readonly string[],
  options: SmtpClientOptions,
  encrypted: boolean
): Promise<void> {
  if (options.user === null && options.password === null) return;
  if (options.user === null || options.password === null) {
    throw new SmtpClientError("Имя пользователя и пароль SMTP заданы неполно.", false);
  }
  if (!encrypted) {
    throw new SmtpClientError(
      "Передача учётных данных SMTP без TLS запрещена.",
      false
    );
  }
  const methods = authenticationMethods(capabilitiesValue);
  if (methods.has("PLAIN")) {
    const token = Buffer.from(`\u0000${options.user}\u0000${options.password}`, "utf8").toString(
      "base64"
    );
    await command(reader, `AUTH PLAIN ${token}`, [235, 503], "Ошибка AUTH PLAIN");
    return;
  }
  if (methods.has("LOGIN")) {
    await command(reader, "AUTH LOGIN", [334], "Ошибка AUTH LOGIN");
    await command(
      reader,
      Buffer.from(options.user, "utf8").toString("base64"),
      [334],
      "SMTP не принял имя пользователя"
    );
    await command(
      reader,
      Buffer.from(options.password, "utf8").toString("base64"),
      [235, 503],
      "SMTP не принял пароль"
    );
    return;
  }
  throw new SmtpClientError(
    "SMTP-сервер не объявил поддерживаемый способ аутентификации PLAIN или LOGIN.",
    false
  );
}

export async function sendSmtpMail(
  options: SmtpClientOptions,
  input: SmtpMailInput,
  signal?: AbortSignal
): Promise<SmtpSendResult> {
  if (signal?.aborted) {
    throw new SmtpClientError("Отправка письма отменена.", true);
  }
  const from = normalizeEmailAddress(input.fromAddress);
  const recipient = normalizeEmailAddress(input.recipientEmail);
  const reader = new SmtpResponseReader(options.timeoutMs);
  let socket: SmtpSocket | null = null;
  const abort = (): void => {
    socket?.destroy(new Error("Отправка письма отменена."));
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    socket = await connectSocket(options, reader);
    let encrypted = options.secure;
    const greeting = await reader.read();
    if (greeting.code !== 220) throw smtpFailure(greeting, "SMTP-сервер отклонил соединение");

    const heloName = hostname().replace(/[^A-Za-z0-9.-]+/gu, "-") || "docomator.local";
    let ehlo = await command(reader, `EHLO ${heloName}`, [250], "Ошибка EHLO");
    let advertised = capabilities(ehlo);

    if (!options.secure && options.startTls) {
      if (!hasCapability(advertised, "STARTTLS")) {
        throw new SmtpClientError(
          "SMTP-сервер не поддерживает обязательный STARTTLS.",
          false
        );
      }
      await command(reader, "STARTTLS", [220], "SMTP не разрешил STARTTLS");
      socket = await upgradeToTls(socket, options, reader);
      encrypted = true;
      ehlo = await command(
        reader,
        `EHLO ${heloName}`,
        [250],
        "Ошибка EHLO после STARTTLS"
      );
      advertised = capabilities(ehlo);
    }

    await authenticate(reader, advertised, options, encrypted);
    const mime = buildMimeMessage(input);
    await command(
      reader,
      `MAIL FROM:<${from.address}>`,
      [250],
      "SMTP не принял отправителя"
    );
    await command(
      reader,
      `RCPT TO:<${recipient.address}>`,
      [250, 251],
      "SMTP не принял получателя"
    );
    await command(reader, "DATA", [354], "SMTP не разрешил передачу письма");
    reader.write(`${dotStuff(mime)}\r\n.\r\n`);
    const accepted = await reader.read();
    if (accepted.code !== 250) {
      throw smtpFailure(accepted, "SMTP не принял письмо");
    }
    await command(reader, "QUIT", [221], "Ошибка завершения SMTP-сессии").catch(
      () => undefined
    );
    return {
      response: `SMTP ${accepted.code} ${accepted.lines.join(" ")}`.slice(0, 2_000)
    };
  } catch (error) {
    throw networkError(error);
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.close();
  }
}
