package api_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	taskseventsv1 "github.com/aedst/server/gen/go/aedst/tasks/events/v1"
	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/events/goldentest"
)

// eventContracts pairs every published event with its Protobuf message
// (api/proto/aedst/tasks/events/v1) and its Go payload struct.
var eventContracts = []struct {
	eventType string
	version   int
	message   func() proto.Message
	payload   any
}{
	{api.TaskCompletedEventType, api.TaskCompletedEventVersion, func() proto.Message { return new(taskseventsv1.TaskCompleted) }, api.TaskCompletedEvent{}},
	{api.TaskCreatedEventType, api.TaskCreatedEventVersion, func() proto.Message { return new(taskseventsv1.TaskSnapshot) }, api.TaskSnapshot{}},
	{api.TaskUpdatedEventType, api.TaskUpdatedEventVersion, func() proto.Message { return new(taskseventsv1.TaskSnapshot) }, api.TaskSnapshot{}},
	{api.TaskDeletedEventType, api.TaskDeletedEventVersion, func() proto.Message { return new(taskseventsv1.TaskDeleted) }, api.TaskDeletedEvent{}},
	{api.TaskDueSoonEventType, api.TaskDueSoonEventVersion, func() proto.Message { return new(taskseventsv1.TaskDueSoon) }, api.TaskDueSoonEvent{}},
}

// wireJSON is the event wire format: ProtoJSON with the proto (snake_case) field names.
var wireJSON = protojson.MarshalOptions{UseProtoNames: true}

// The golden fixtures are valid ProtoJSON of the contract messages (strictly: an
// unknown or retyped field fails) and survive a round trip through them, so a
// consumer in any language can decode the payload with generated code.
func TestEventFixturesAreTheProtobufContractOnTheWire(t *testing.T) {
	for _, c := range eventContracts {
		name := fmt.Sprintf("%s.v%d.json", goldentest.Name(c.eventType), c.version)
		t.Run(name, func(t *testing.T) {
			fixture, err := os.ReadFile(filepath.Join("testdata", name))
			if err != nil {
				t.Fatal(err)
			}
			msg := c.message()
			if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(fixture, msg); err != nil {
				t.Fatalf("the fixture is not valid ProtoJSON of %s: %v", msg.ProtoReflect().Descriptor().FullName(), err)
			}
			encoded, err := wireJSON.Marshal(msg)
			if err != nil {
				t.Fatal(err)
			}
			var want, got map[string]any
			if err := json.Unmarshal(fixture, &want); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(encoded, &got); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("ProtoJSON round trip changed the payload:\n got %v\nwant %v", got, want)
			}

			// And the other direction: what the Go producer writes decodes as the message.
			payload := reflect.New(reflect.TypeOf(c.payload))
			if err := json.Unmarshal(fixture, payload.Interface()); err != nil {
				t.Fatal(err)
			}
			produced, err := json.Marshal(payload.Interface())
			if err != nil {
				t.Fatal(err)
			}
			if err := protojson.Unmarshal(produced, c.message()); err != nil {
				t.Fatalf("the producer's JSON is not valid ProtoJSON of the contract: %v", err)
			}
		})
	}
}

// The Go payload structs mirror the messages field for field: same JSON names,
// compatible types. Adding a field to one side only fails here, so `buf breaking`
// on the .proto really guards what is published.
func TestEventStructsMatchTheProtobufContract(t *testing.T) {
	timeType := reflect.TypeFor[time.Time]()
	for _, c := range eventContracts {
		desc := c.message().ProtoReflect().Descriptor()
		t.Run(string(desc.Name())+"/"+goldentest.Name(c.eventType), func(t *testing.T) {
			structFields := map[string]reflect.Type{}
			typ := reflect.TypeOf(c.payload)
			for field := range typ.Fields() {
				name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
				structFields[name] = field.Type
			}
			fields := desc.Fields()
			if fields.Len() != len(structFields) {
				t.Errorf("%s has %d fields, %s has %d", desc.FullName(), fields.Len(), typ, len(structFields))
			}
			for i := range fields.Len() {
				field := fields.Get(i)
				goType, ok := structFields[string(field.Name())]
				if !ok {
					t.Errorf("%s.%s has no field with that JSON name in %s", desc.FullName(), field.Name(), typ)
					continue
				}
				if goType.Kind() == reflect.Pointer {
					goType = goType.Elem()
				}
				compatible := map[protoreflect.Kind]bool{
					protoreflect.StringKind:  goType.Kind() == reflect.String,
					protoreflect.Int32Kind:   goType.Kind() == reflect.Int || goType.Kind() == reflect.Int32,
					protoreflect.MessageKind: field.Message() != nil && field.Message().FullName() == "google.protobuf.Timestamp" && goType == timeType,
				}
				if !compatible[field.Kind()] {
					t.Errorf("%s.%s is %s but the Go field is %s", desc.FullName(), field.Name(), field.Kind(), goType)
				}
			}
		})
	}
}
