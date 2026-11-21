package cache

import (
	"encoding/json"
	"errors"
	"fmt"

	"google.golang.org/protobuf/proto"
)

// Entry markers: the first byte of a stored value says how to read the rest.
// An unknown marker (another release's format) is treated as a miss.
const (
	markJSON     byte = 'j'
	markProto    byte = 'p'
	markNegative byte = 'n'
)

var errUnknownEntry = errors.New("cache: unknown entry format")

// encode serialises v behind its marker: Protobuf wire format when T is a
// generated message, encoding/json otherwise.
func encode[T any](v T) ([]byte, error) {
	if m, ok := any(v).(proto.Message); ok {
		out, err := proto.MarshalOptions{}.MarshalAppend([]byte{markProto}, m)
		if err != nil {
			return nil, fmt.Errorf("cache: encode: %w", err)
		}
		return out, nil
	}
	body, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("cache: encode: %w", err)
	}
	return append([]byte{markJSON}, body...), nil
}

// decode reads an entry written by encode. negative reports a tombstone.
func decode[T any](raw []byte) (v T, negative bool, err error) {
	if len(raw) == 0 {
		return v, false, errUnknownEntry
	}
	switch raw[0] {
	case markNegative:
		return v, true, nil
	case markProto:
		zero, ok := any(v).(proto.Message)
		if !ok {
			return v, false, errUnknownEntry
		}
		// T is a pointer to a generated message; ProtoReflect works on its nil
		// value and New allocates the concrete type.
		m := zero.ProtoReflect().New().Interface()
		if err := proto.Unmarshal(raw[1:], m); err != nil {
			return v, false, fmt.Errorf("cache: decode: %w", err)
		}
		out, ok := m.(T)
		if !ok {
			return v, false, errUnknownEntry
		}
		return out, false, nil
	case markJSON:
		if err := json.Unmarshal(raw[1:], &v); err != nil {
			var zero T
			return zero, false, fmt.Errorf("cache: decode: %w", err)
		}
		return v, false, nil
	default:
		return v, false, errUnknownEntry
	}
}
