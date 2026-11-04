package architecturetest

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	// Register every service's descriptors in protoregistry.GlobalFiles.
	_ "github.com/aedst/server/gen/go/aedst/admin/v1"
	_ "github.com/aedst/server/gen/go/aedst/appattest/v1"
	_ "github.com/aedst/server/gen/go/aedst/capabilities/v1"
	_ "github.com/aedst/server/gen/go/aedst/integrity/v1"
	_ "github.com/aedst/server/gen/go/aedst/media/v1"
	_ "github.com/aedst/server/gen/go/aedst/notifications/v1"
	_ "github.com/aedst/server/gen/go/aedst/search/v1"
	_ "github.com/aedst/server/gen/go/aedst/tasks/v1"
)

// TestProtovalidateConventions checks, on the generated descriptors of every
// aedst.* request message, the conventions that keep a client-controlled list
// bounded and unambiguous:
//   - page_size has an upper bound (lte / lt);
//   - page_token has max_len;
//   - a repeated enum field excludes the zero value (items.enum.not_in contains 0).
func TestProtovalidateConventions(t *testing.T) {
	seen := 0
	protoregistry.GlobalFiles.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		if !strings.HasPrefix(string(fd.Package()), "aedst.") {
			return true
		}
		msgs := fd.Messages()
		for i := range msgs.Len() {
			seen++
			for _, msg := range protoConventionViolations(msgs.Get(i)) {
				t.Error(msg)
			}
		}
		return true
	})
	if seen == 0 {
		t.Fatal("no aedst.* messages in protoregistry.GlobalFiles: the descriptor imports are missing")
	}
}

// TestProtovalidateConventionsRejectUnboundedFields is the negative self-test: a request
// with an unbounded page_size, an unbounded page_token and a repeated enum without
// not_in [0] is reported; the same message with the rules in place is clean.
func TestProtovalidateConventionsRejectUnboundedFields(t *testing.T) {
	bad := syntheticRequest(t, false)
	got := protoConventionViolations(bad)
	if len(got) != 3 {
		t.Fatalf("violations = %q, want one each for page_size, page_token and the repeated enum", got)
	}
	if good := protoConventionViolations(syntheticRequest(t, true)); len(good) != 0 {
		t.Fatalf("a conforming message must be clean, got %q", good)
	}
}

func protoConventionViolations(md protoreflect.MessageDescriptor) []string {
	var out []string
	if strings.HasSuffix(string(md.Name()), "Request") {
		fields := md.Fields()
		for i := range fields.Len() {
			fd := fields.Get(i)
			rules := fieldRules(fd)
			switch {
			case fd.Name() == "page_size":
				if r := rules.GetInt32(); r == nil || r.LessThan == nil {
					out = append(out, fmt.Sprintf("%s: page_size needs an upper bound (int32 lte)", fd.FullName()))
				}
			case fd.Name() == "page_token":
				if r := rules.GetString(); r == nil || r.MaxLen == nil {
					out = append(out, fmt.Sprintf("%s: page_token needs string max_len", fd.FullName()))
				}
			case fd.IsList() && fd.Kind() == protoreflect.EnumKind:
				if r := rules.GetRepeated().GetItems().GetEnum(); r == nil || !slices.Contains(r.NotIn, 0) {
					out = append(out, fmt.Sprintf("%s: repeated enum needs items.enum.not_in [0]", fd.FullName()))
				}
			}
		}
	}
	nested := md.Messages()
	for i := range nested.Len() {
		out = append(out, protoConventionViolations(nested.Get(i))...)
	}
	return out
}

func fieldRules(fd protoreflect.FieldDescriptor) *validate.FieldRules {
	opts, ok := fd.Options().(*descriptorpb.FieldOptions)
	if !ok || opts == nil {
		return nil
	}
	rules, _ := proto.GetExtension(opts, validate.E_Field).(*validate.FieldRules)
	return rules
}

// syntheticRequest builds ListThingsRequest{page_size, page_token, repeated Color colors}.
func syntheticRequest(t *testing.T, withRules bool) protoreflect.MessageDescriptor {
	t.Helper()
	opt := func(r *validate.FieldRules) *descriptorpb.FieldOptions {
		if !withRules {
			return nil
		}
		o := &descriptorpb.FieldOptions{}
		proto.SetExtension(o, validate.E_Field, r)
		return o
	}
	typeEnum := descriptorpb.FieldDescriptorProto_TYPE_ENUM
	file := &descriptorpb.FileDescriptorProto{
		Name:    proto.String("selftest.proto"),
		Package: proto.String("selftest"),
		Syntax:  proto.String("proto3"),
		EnumType: []*descriptorpb.EnumDescriptorProto{{
			Name:  proto.String("Color"),
			Value: []*descriptorpb.EnumValueDescriptorProto{{Name: proto.String("COLOR_UNSPECIFIED"), Number: proto.Int32(0)}, {Name: proto.String("COLOR_RED"), Number: proto.Int32(1)}},
		}},
		MessageType: []*descriptorpb.DescriptorProto{{
			Name: proto.String("ListThingsRequest"),
			Field: []*descriptorpb.FieldDescriptorProto{
				{
					Name: proto.String("page_size"), Number: proto.Int32(1), Type: descriptorpb.FieldDescriptorProto_TYPE_INT32.Enum(), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
					Options: opt(&validate.FieldRules{Type: &validate.FieldRules_Int32{Int32: &validate.Int32Rules{LessThan: &validate.Int32Rules_Lte{Lte: 100}}}}),
				},
				{
					Name: proto.String("page_token"), Number: proto.Int32(2), Type: descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(), Label: descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
					Options: opt(&validate.FieldRules{Type: &validate.FieldRules_String_{String_: &validate.StringRules{MaxLen: proto.Uint64(512)}}}),
				},
				{
					Name: proto.String("colors"), Number: proto.Int32(3), Type: &typeEnum, TypeName: proto.String(".selftest.Color"), Label: descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(),
					Options: opt(&validate.FieldRules{Type: &validate.FieldRules_Repeated{Repeated: &validate.RepeatedRules{Items: &validate.FieldRules{
						Type: &validate.FieldRules_Enum{Enum: &validate.EnumRules{NotIn: []int32{0}}},
					}}}}),
				},
			},
		}},
	}
	fd, err := protodesc.NewFile(file, nil)
	if err != nil {
		t.Fatalf("build synthetic descriptor: %v", err)
	}
	return fd.Messages().ByName("ListThingsRequest")
}
