/**
 * @stalkier/ui — a tela do gravador, uma só.
 *
 * O app público monta com o adaptador de IPC e as strings em inglês; a aba do
 * Jaques Studio monta com o adaptador HTTP e as strings em português. Layout,
 * estados, teclado e decisões de hierarquia são o MESMO código — que é onde
 * mais se mexe, e por isso onde duas cópias divergiriam mais rápido.
 *
 * Importe também `@stalkier/ui/theme.css`: ele define os tokens com fallback
 * pro tema do app hospedeiro, então dentro do Studio a tela pega a paleta de lá
 * sem ninguém configurar nada.
 */
export { Recorder, type RecorderProps } from './Recorder.js';
export type { MonthUsage, RecorderApi, SettingsSnapshot } from './api.js';
export { en, pt, type Strings } from './strings.js';
