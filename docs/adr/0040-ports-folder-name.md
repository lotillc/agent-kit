# ADR-0040 — `ports/` folder name

- Status: Accepted
- Date: 2026-04-20

## Context

The folder holds every injectable interface. 'Ports' is Hexagonal Architecture (Alistair Cockburn, 2005) vocabulary and recognizable to senior architects doing a review.

## Decision

Name the folder `ports/`. `adapters/` holds implementations.

## Consequences

Standard term; architectural intent is explicit. Alternative names (`interfaces/`, `contracts/`) would hide the hexagonal shape.
