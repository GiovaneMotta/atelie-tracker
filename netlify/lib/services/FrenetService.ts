/* ================================================================
   FrenetService (fachada de compatibilidade).
   A implementação real da integração vive em `netlify/lib/frenet/`
   (client + quote + shipment + label + tracking), desacoplada por
   serviço (§31). Este arquivo apenas reexporta, preservando o caminho
   histórico citado na ARCHITECTURE.md. Prefira importar de '../frenet'.
   ================================================================ */
export {
  loadFrenetConfig,
  loadStoredSettings,
  publicConfigView,
  FrenetError,
  FrenetQuoteService,
  FrenetShipmentService,
  FrenetLabelService,
  FrenetTrackingService,
} from '../frenet';
export type { FrenetConfig } from '../frenet';
