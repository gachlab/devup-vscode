import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { considerTour } from '../../src/tour.js';

describe('considerTour', () => {
  it('ofrece el tour la primera vez que hay un stack vivo', () => {
    assert.deepEqual(considerTour({ alreadyOffered: false, connected: true }), { show: true, remember: true });
  });

  it('no lo ofrece dos veces', () => {
    // La regla entera: se recuerda al ofrecerlo, no al responderlo. Diga que
    // sí, que no, o cierre el aviso sin contestar, ya tuvo su turno.
    assert.equal(considerTour({ alreadyOffered: true, connected: true }).show, false);
  });

  it('no lo ofrece sin daemon', () => {
    // Apuntaría a un tour cuyo primer paso es "arranca el stack": cierto, pero
    // se lee como ruido de una extensión que aún no tiene nada que enseñar.
    assert.equal(considerTour({ alreadyOffered: false, connected: false }).show, false);
  });

  it('no gasta el turno cuando no llega a ofrecerlo', () => {
    // Si se marcara como ofrecido con el daemon abajo, el usuario perdería el
    // aviso sin haberlo visto nunca.
    assert.equal(considerTour({ alreadyOffered: false, connected: false }).remember, false);
  });
});
